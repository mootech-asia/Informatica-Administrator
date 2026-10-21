'use strict';

const $ = sel => document.querySelector(sel);

const state = {
  me: null,
  sections: [],
  items: [],          // items visible to the current user
  users: [],          // admin only
  selectedUserId: null,
};

// ---------- helpers ----------

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error(data.error || '請先登入');
  }
  if (!res.ok) throw new Error(data.error || `錯誤 ${res.status}`);
  return data;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

function groupBySection(items) {
  const map = new Map(state.sections.map(s => [s, []]));
  for (const it of items) (map.get(it.section) || map.set(it.section, []).get(it.section)).push(it);
  return map;
}

// ---------- views ----------

function showLogin() {
  state.me = null;
  $('#main-view').hidden = true;
  $('#login-view').hidden = false;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  $('#login-form [name=username]').focus();
}

async function showMain() {
  $('#login-view').hidden = true;
  $('#main-view').hidden = false;
  $('#whoami').textContent = `${state.me.username}${state.me.role === 'admin' ? '（管理員）' : ''}`;
  $('#btn-admin').hidden = state.me.role !== 'admin';
  await loadItems();
}

async function loadItems() {
  const data = await api('/api/items');
  state.sections = data.sections;
  state.items = data.items;
  renderSections();
}

function renderSections() {
  const q = $('#search').value.trim().toLowerCase();
  const isAdmin = state.me.role === 'admin';
  const container = $('#sections');
  container.replaceChildren();

  const groups = groupBySection(state.items);
  let shown = 0;
  for (const [section, all] of groups) {
    const items = q
      ? all.filter(i => `${i.name} ${i.location} ${section}`.toLowerCase().includes(q))
      : all;
    // Regular users only see sections they have something in.
    if (!isAdmin && all.length === 0) continue;
    if (q && items.length === 0) continue;
    shown++;

    const body = items.length
      ? el('table', { class: 'item-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Location'), el('th', {}, 'Name'))),
          el('tbody', {}, items.map(it => el('tr', {},
            el('td', { class: 'loc' }, it.location || '—'),
            el('td', {}, it.url
              ? el('a', { class: 'item-link', href: it.url, target: '_blank', rel: 'noopener noreferrer' },
                  it.name, el('span', { class: 'arrow' }, '↗'))
              : el('span', { class: 'item-link disabled', title: '尚未設定網址' },
                  it.name, el('span', { class: 'arrow' }, '未設定'))),
          ))))
      : el('div', { class: 'empty' }, '尚無子項目');

    container.append(el('section', { class: 'section-card' },
      el('header', {}, el('h2', {}, section), el('span', { class: 'badge' }, `${items.length} 項`)),
      body));
  }
  if (!shown) {
    container.append(el('div', { class: 'empty' },
      q ? '找不到符合的子項目' : '目前沒有可檢視的子項目，請聯絡管理員開通權限'));
  }
}

// ---------- login / logout / password ----------

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  $('#login-error').textContent = '';
  try {
    const { user } = await api('/api/login', {
      method: 'POST',
      body: { username: f.username.value, password: f.password.value },
    });
    state.me = user;
    f.reset();
    await showMain();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

$('#btn-password').addEventListener('click', () => {
  $('#password-form').reset();
  $('#password-error').textContent = '';
  $('#password-dialog').showModal();
});

$('#password-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (f.newPassword.value !== f.confirm.value) {
    $('#password-error').textContent = '兩次輸入的新密碼不一致';
    return;
  }
  try {
    await api('/api/me/password', {
      method: 'POST',
      body: { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value },
    });
    $('#password-dialog').close();
    toast('密碼已更新');
  } catch (err) {
    $('#password-error').textContent = err.message;
  }
});

$('#search').addEventListener('input', renderSections);

document.querySelectorAll('dialog [data-close]').forEach(b =>
  b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- admin: dialog & tabs ----------

$('#btn-admin').addEventListener('click', async () => {
  await refreshAdmin();
  selectUser(state.selectedUserId && state.users.some(u => u.id === state.selectedUserId)
    ? state.selectedUserId : null);
  resetItemForm();
  $('#admin-dialog').showModal();
});

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
}));

$('#admin-dialog').addEventListener('close', () => loadItems().catch(() => {}));

async function refreshAdmin() {
  const [{ users }, { items, sections }] = await Promise.all([api('/api/admin/users'), api('/api/items')]);
  state.users = users;
  state.items = items;
  state.sections = sections;
  renderUserList();
  renderItemTable();
}

// ---------- admin: users ----------

function renderUserList() {
  $('#user-list').replaceChildren(...state.users.map(u => el('li', {},
    el('button', {
      type: 'button',
      class: u.id === state.selectedUserId ? 'active' : '',
      onclick: () => selectUser(u.id),
    },
      el('span', {}, u.username),
      el('span', { class: `role-tag ${u.role}` }, u.role === 'admin' ? '管理員' : `${u.items.length} 項`)),
  )));
}

function renderPermList(checkedIds) {
  const checked = new Set(checkedIds);
  const groups = groupBySection(state.items);
  $('#perm-list').replaceChildren(...[...groups].map(([section, items]) => {
    const boxes = items.map(it => el('input', {
      type: 'checkbox', value: it.id, checked: checked.has(it.id), onchange: syncGroupBoxes,
    }));
    const groupBox = el('input', {
      type: 'checkbox',
      disabled: items.length === 0,
      onchange: e => { boxes.forEach(b => { b.checked = e.target.checked; }); },
    });
    const group = el('div', { class: 'perm-group' },
      el('h4', {}, el('label', { class: 'check' }, groupBox, section)),
      items.length
        ? items.map((it, i) => el('label', { class: 'check' }, boxes[i],
            it.location ? `${it.name}（${it.location}）` : it.name))
        : el('div', { class: 'none' }, '尚無子項目'));
    group._sync = () => {
      const n = boxes.filter(b => b.checked).length;
      groupBox.checked = n > 0 && n === boxes.length;
      groupBox.indeterminate = n > 0 && n < boxes.length;
    };
    group._sync();
    return group;
  }));
}

function syncGroupBoxes() {
  document.querySelectorAll('#perm-list .perm-group').forEach(g => g._sync());
}

document.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => {
  const on = b.dataset.check === 'all';
  document.querySelectorAll('#perm-list input[type=checkbox]:not(:disabled)').forEach(c => { c.checked = on; });
  syncGroupBoxes();
}));

function selectUser(id) {
  state.selectedUserId = id;
  const u = state.users.find(x => x.id === id);
  const f = $('#user-form');
  f.reset();
  $('#user-form-error').textContent = '';
  $('#user-form-title').textContent = u ? `編輯帳號：${u.username}` : '新增帳號';
  $('#pw-label').textContent = u ? '重設密碼（留空則不變）' : '密碼（至少 8 字元）';
  f.username.value = u ? u.username : '';
  f.username.readOnly = !!u;
  f.password.required = !u;
  f.role.value = u ? u.role : 'user';
  $('#btn-delete-user').hidden = !u || u.id === state.me.id;
  renderPermList(u ? u.items : []);
  updatePermDisabled();
  renderUserList();
}

function updatePermDisabled() {
  const isAdminRole = $('#user-form').role.value === 'admin';
  $('#perm-fieldset').disabled = isAdminRole;
  $('#perm-fieldset').title = isAdminRole ? '管理員可檢視所有子項目' : '';
}

$('#user-form').role.addEventListener('change', updatePermDisabled);
$('#btn-new-user').addEventListener('click', () => { selectUser(null); $('#user-form').username.focus(); });

$('#user-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const items = [...document.querySelectorAll('#perm-list input[value]:checked')].map(c => c.value);
  const body = { role: f.role.value, items };
  if (f.password.value) body.password = f.password.value;
  $('#user-form-error').textContent = '';
  try {
    let user;
    if (state.selectedUserId) {
      ({ user } = await api(`/api/admin/users/${state.selectedUserId}`, { method: 'PUT', body }));
    } else {
      ({ user } = await api('/api/admin/users', { method: 'POST', body: { ...body, username: f.username.value } }));
    }
    await refreshAdmin();
    if (user.id === state.me.id) state.me = user;
    selectUser(user.id);
    toast('帳號已儲存');
  } catch (err) {
    $('#user-form-error').textContent = err.message;
  }
});

$('#btn-delete-user').addEventListener('click', async () => {
  const u = state.users.find(x => x.id === state.selectedUserId);
  if (!u || !confirm(`確定要刪除帳號「${u.username}」？`)) return;
  try {
    await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    await refreshAdmin();
    selectUser(null);
    toast('帳號已刪除');
  } catch (err) {
    $('#user-form-error').textContent = err.message;
  }
});

// ---------- admin: items ----------

function renderItemTable() {
  const sel = $('#item-form').section;
  const current = sel.value;
  sel.replaceChildren(...state.sections.map(s => el('option', { value: s }, s)));
  if (current) sel.value = current;

  const rows = [...groupBySection(state.items)].flatMap(([, items]) => items);
  $('#item-table').replaceChildren(...(rows.length ? rows.map(it => el('tr', {},
    el('td', {}, it.section),
    el('td', {}, it.location || '—'),
    el('td', {}, it.name),
    el('td', { class: 'url', title: it.url }, it.url || '（未設定）'),
    el('td', { class: 'actions' },
      el('button', { class: 'link', type: 'button', onclick: () => editItem(it) }, '編輯'),
      el('button', { class: 'link danger', type: 'button', onclick: () => deleteItem(it) }, '刪除')),
  )) : [el('tr', {}, el('td', { colspan: 5, class: 'empty' }, '尚無子項目'))]));
}

function resetItemForm() {
  const f = $('#item-form');
  const section = f.section.value;
  f.reset();
  f.id.value = '';
  if (section) f.section.value = section;
  $('#btn-save-item').textContent = '新增';
  $('#btn-cancel-item').hidden = true;
  $('#item-form-error').textContent = '';
}

function editItem(it) {
  const f = $('#item-form');
  f.id.value = it.id;
  f.section.value = it.section;
  f.location.value = it.location;
  f.name.value = it.name;
  f.url.value = it.url;
  $('#btn-save-item').textContent = '儲存';
  $('#btn-cancel-item').hidden = false;
  f.name.focus();
}

async function deleteItem(it) {
  if (!confirm(`確定要刪除「${it.section} / ${it.name}」？\n所有帳號對此子項目的權限也會一併移除。`)) return;
  try {
    await api(`/api/admin/items/${it.id}`, { method: 'DELETE' });
    await refreshAdmin();
    resetItemForm();
    toast('子項目已刪除');
  } catch (err) {
    $('#item-form-error').textContent = err.message;
  }
}

$('#btn-cancel-item').addEventListener('click', resetItemForm);

$('#item-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const body = { section: f.section.value, location: f.location.value, name: f.name.value, url: f.url.value };
  try {
    if (f.id.value) await api(`/api/admin/items/${f.id.value}`, { method: 'PUT', body });
    else await api('/api/admin/items', { method: 'POST', body });
    await refreshAdmin();
    resetItemForm();
    toast('子項目已儲存');
  } catch (err) {
    $('#item-form-error').textContent = err.message;
  }
});

// ---------- boot ----------

(async () => {
  try {
    const { user } = await api('/api/me');
    state.me = user;
    await showMain();
  } catch {
    showLogin();
  }
})();
