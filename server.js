'use strict';

// INFA 監控後台 — zero-dependency Node.js server.
// Data is stored in data/db.json; sessions live in memory.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = 'infa_sid';
const SECURE_COOKIE = process.env.COOKIE_SECURE === '1';

const SECTIONS = ['TWIDC', 'JPIDC', 'PHIDC', 'PH Office', 'PH Studio', 'SL Office'];

const SEED_ITEMS = [
  ...['Cacti', 'Zabbix', 'WAN PRTG', 'LAN PRTG', 'Ext PRTG', 'Graylog', 'Graylog2',
    'Looking glass', 'Streaming wall', 'haproxystat', 'NTOP', 'Wazuh']
    .map(name => ({ section: 'TWIDC', location: 'TW', name })),
  ...['Cacti', 'Zabbix', 'PRTG', 'Graylog']
    .map(name => ({ section: 'JPIDC', location: 'JP', name })),
];

// ---------- storage ----------

let db;

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return;
  }
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db = {
    users: [{
      id: newId(),
      username: process.env.ADMIN_USER || 'admin',
      password: hashPassword(password),
      role: 'admin',
      items: [],
      createdAt: new Date().toISOString(),
    }],
    items: SEED_ITEMS.map((it, i) => ({ id: newId(), ...it, url: '', order: i })),
  };
  saveDb();
  console.log('==============================================');
  console.log(' 初始化完成，已建立管理員帳號');
  console.log(`   帳號: ${db.users[0].username}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`   密碼: ${password}`);
  console.log(' 請登入後立即修改密碼');
  console.log('==============================================');
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

// ---------- passwords ----------

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Burn the same time on unknown usernames so they can't be enumerated by timing.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

// ---------- sessions & rate limiting ----------

const sessions = new Map(); // sid -> { userId, expires }

function createSession(userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, { userId, expires: Date.now() + SESSION_TTL_MS });
  return sid;
}

function destroyUserSessions(userId, exceptSid) {
  for (const [sid, s] of sessions) {
    if (s.userId === userId && sid !== exceptSid) sessions.delete(sid);
  }
}

const loginAttempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const a = loginAttempts.get(ip);
  return a && a.resetAt > Date.now() && a.count >= MAX_ATTEMPTS;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const a = loginAttempts.get(ip);
  if (!a || a.resetAt <= now) loginAttempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  else a.count++;
}

setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) if (s.expires <= now) sessions.delete(sid);
  for (const [ip, a] of loginAttempts) if (a.resetAt <= now) loginAttempts.delete(ip);
}, 10 * 60 * 1000).unref();

// ---------- http helpers ----------

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, sid, maxAgeSec) {
  const attrs = [`${COOKIE_NAME}=${sid}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (SECURE_COOKIE) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) {
      return reject(new HttpError(415, 'Content-Type 必須為 application/json'));
    }
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 1e6) { reject(new HttpError(413, '請求過大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'JSON 格式錯誤')); }
    });
    req.on('error', reject);
  });
}

function currentUser(req) {
  const sid = parseCookies(req)[COOKIE_NAME];
  const s = sid && sessions.get(sid);
  if (!s || s.expires <= Date.now()) return null;
  s.expires = Date.now() + SESSION_TTL_MS; // sliding expiry
  const user = db.users.find(u => u.id === s.userId);
  return user ? { user, sid } : null;
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, items: u.items, createdAt: u.createdAt };
}

function visibleItems(user) {
  const list = user.role === 'admin' ? db.items : db.items.filter(i => user.items.includes(i.id));
  return [...list].sort((a, b) => a.order - b.order);
}

// ---------- validation ----------

function str(v, field, { max = 200, required = true } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, `${field} 格式錯誤`);
  v = v.trim();
  if (required && !v) throw new HttpError(400, `${field} 不可空白`);
  if (v.length > max) throw new HttpError(400, `${field} 過長`);
  return v;
}

function validUsername(v) {
  v = str(v, '帳號', { max: 64 });
  if (!/^[A-Za-z0-9._@-]+$/.test(v)) throw new HttpError(400, '帳號僅可使用英數字及 . _ @ -');
  return v;
}

function validPassword(v) {
  if (typeof v !== 'string' || v.length < 8) throw new HttpError(400, '密碼至少需 8 個字元');
  if (v.length > 200) throw new HttpError(400, '密碼過長');
  return v;
}

function validUrl(v) {
  v = str(v, '網址', { max: 2000, required: false });
  if (v && !/^https?:\/\//i.test(v)) throw new HttpError(400, '網址必須以 http:// 或 https:// 開頭');
  return v;
}

function validItemIds(v) {
  if (!Array.isArray(v)) throw new HttpError(400, '子項目清單格式錯誤');
  const known = new Set(db.items.map(i => i.id));
  return [...new Set(v.filter(id => known.has(id)))];
}

// ---------- routes ----------

async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;
  const ip = req.socket.remoteAddress;

  if (p === '/api/login' && method === 'POST') {
    if (isRateLimited(ip)) throw new HttpError(429, '登入失敗次數過多，請稍後再試');
    const body = await readJson(req);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    const ok = verifyPassword(password, user ? user.password : DUMMY_HASH) && !!user;
    if (!ok) {
      recordFailedLogin(ip);
      throw new HttpError(401, '帳號或密碼錯誤');
    }
    loginAttempts.delete(ip);
    setSessionCookie(res, createSession(user.id), SESSION_TTL_MS / 1000);
    return send(res, 200, { user: publicUser(user) });
  }

  if (p === '/api/logout' && method === 'POST') {
    const sid = parseCookies(req)[COOKIE_NAME];
    if (sid) sessions.delete(sid);
    setSessionCookie(res, '', 0);
    return send(res, 200, { ok: true });
  }

  const auth = currentUser(req);
  if (!auth) throw new HttpError(401, '請先登入');
  const me = auth.user;

  if (p === '/api/me' && method === 'GET') {
    return send(res, 200, { user: publicUser(me), sections: SECTIONS });
  }

  if (p === '/api/items' && method === 'GET') {
    return send(res, 200, { sections: SECTIONS, items: visibleItems(me) });
  }

  if (p === '/api/me/password' && method === 'POST') {
    const body = await readJson(req);
    if (!verifyPassword(String(body.currentPassword || ''), me.password)) {
      throw new HttpError(400, '目前密碼不正確');
    }
    me.password = hashPassword(validPassword(body.newPassword));
    destroyUserSessions(me.id, auth.sid);
    saveDb();
    return send(res, 200, { ok: true });
  }

  // ---- everything below is admin only ----
  if (!p.startsWith('/api/admin/')) throw new HttpError(404, 'Not found');
  if (me.role !== 'admin') throw new HttpError(403, '權限不足');

  const parts = p.split('/').filter(Boolean); // ['api','admin',resource,id?]
  const resource = parts[2];
  const id = parts[3];

  if (resource === 'users') {
    if (!id && method === 'GET') {
      return send(res, 200, { users: db.users.map(publicUser) });
    }
    if (!id && method === 'POST') {
      const body = await readJson(req);
      const username = validUsername(body.username);
      if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        throw new HttpError(409, '帳號已存在');
      }
      const user = {
        id: newId(),
        username,
        password: hashPassword(validPassword(body.password)),
        role: body.role === 'admin' ? 'admin' : 'user',
        items: validItemIds(body.items || []),
        createdAt: new Date().toISOString(),
      };
      db.users.push(user);
      saveDb();
      return send(res, 201, { user: publicUser(user) });
    }
    const user = db.users.find(u => u.id === id);
    if (!user) throw new HttpError(404, '找不到帳號');
    if (method === 'PUT') {
      const body = await readJson(req);
      if (body.role !== undefined) {
        const role = body.role === 'admin' ? 'admin' : 'user';
        if (user.role === 'admin' && role !== 'admin' && db.users.filter(u => u.role === 'admin').length === 1) {
          throw new HttpError(400, '至少需保留一位管理員');
        }
        user.role = role;
      }
      if (body.items !== undefined) user.items = validItemIds(body.items);
      if (body.password) {
        user.password = hashPassword(validPassword(body.password));
        destroyUserSessions(user.id, user.id === me.id ? auth.sid : undefined);
      }
      saveDb();
      return send(res, 200, { user: publicUser(user) });
    }
    if (method === 'DELETE') {
      if (user.id === me.id) throw new HttpError(400, '不可刪除自己的帳號');
      db.users = db.users.filter(u => u.id !== user.id);
      destroyUserSessions(user.id);
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  if (resource === 'items') {
    const readItem = body => ({
      section: (() => {
        const s = str(body.section, '區域');
        if (!SECTIONS.includes(s)) throw new HttpError(400, '區域不存在');
        return s;
      })(),
      location: str(body.location, 'Location', { max: 100, required: false }),
      name: str(body.name, 'Name', { max: 100 }),
      url: validUrl(body.url),
    });
    if (!id && method === 'POST') {
      const body = await readJson(req);
      const order = db.items.reduce((m, i) => Math.max(m, i.order), -1) + 1;
      const item = { id: newId(), ...readItem(body), order };
      db.items.push(item);
      saveDb();
      return send(res, 201, { item });
    }
    const item = db.items.find(i => i.id === id);
    if (!item) throw new HttpError(404, '找不到子項目');
    if (method === 'PUT') {
      Object.assign(item, readItem(await readJson(req)));
      saveDb();
      return send(res, 200, { item });
    }
    if (method === 'DELETE') {
      db.items = db.items.filter(i => i.id !== id);
      for (const u of db.users) u.items = u.items.filter(x => x !== id);
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Not found');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: '伺服器錯誤' });
  }
});

loadDb();
server.listen(PORT, HOST, () => {
  console.log(`INFA 監控後台已啟動: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
