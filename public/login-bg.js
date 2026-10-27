// 登入頁左側的粒子波浪動態背景（純 Canvas，無相依套件）
(() => {
  const canvas = document.getElementById('login-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLS = 140;          // 橫向粒子數
  const ROWS = 48;           // 縱深排數
  const SPREAD_X = 2600;     // 世界座標寬度
  const DEPTH_NEAR = 60;
  const DEPTH_FAR = 2200;
  const FOCAL = 520;
  const CAM_Y = -170;        // 鏡頭高度（負值 = 在波面上方）

  let w = 0, h = 0, dpr = 1;
  const bokeh = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bokeh.length = 0;
    const n = Math.round(w * h / 22000);
    for (let i = 0; i < n; i++) {
      bokeh.push({
        x: Math.random() * w,
        y: h * (0.15 + Math.random() * 0.85),
        r: 1 + Math.random() * (Math.random() < 0.15 ? 14 : 3),
        vx: (Math.random() - 0.5) * 0.15,
        vy: -0.05 - Math.random() * 0.15,
        a: 0.15 + Math.random() * 0.45,
        p: Math.random() * Math.PI * 2,
      });
    }
  }

  // 波面高度：中央低平、兩側隆起，多組正弦疊加讓它持續流動
  function height(x, z, t) {
    const nx = x / (SPREAD_X / 2);                 // -1..1
    const side = Math.pow(Math.abs(nx), 1.6);      // 兩側較高
    return (
      Math.sin(x * 0.004 + t * 0.9) * 40 +
      Math.sin(z * 0.006 - t * 1.3 + x * 0.002) * 28 +
      Math.sin((x + z) * 0.003 + t * 0.6) * 22
    ) * (0.35 + side * 1.4) + side * 260;
  }

  function project(x, y, z) {
    const s = FOCAL / z;
    return [w / 2 + x * s * (w / 900), h * 0.52 + (y - CAM_Y) * s, s];
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#020615');
    g.addColorStop(0.5, '#041435');
    g.addColorStop(1, '#03102e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 地平線中央光暈
    const glow = ctx.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, Math.max(w, h) * 0.55);
    glow.addColorStop(0, 'rgba(40,150,255,0.6)');
    glow.addColorStop(0.35, 'rgba(20,80,220,0.15)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  function frame(ms) {
    if (!w || !canvas.offsetParent) {           // 登入頁隱藏時不繪製
      if (!reduceMotion) requestAnimationFrame(frame);
      return;
    }
    const t = ms / 1000;
    drawBackground();
    ctx.globalCompositeOperation = 'lighter';

    // 由遠到近畫每一排：細線 + 粒子
    for (let r = ROWS - 1; r >= 0; r--) {
      const k = r / (ROWS - 1);
      const z = DEPTH_NEAR + Math.pow(k, 1.5) * (DEPTH_FAR - DEPTH_NEAR);
      const fade = 1 - k * 0.75;

      ctx.beginPath();
      for (let c = 0; c < COLS; c++) {
        const x = (c / (COLS - 1) - 0.5) * SPREAD_X;
        const [px, py] = project(x, -height(x, z, t), z);
        c ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.strokeStyle = `rgba(60,160,255,${0.28 * fade})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      for (let c = 0; c < COLS; c++) {
        const x = (c / (COLS - 1) - 0.5) * SPREAD_X;
        const y = height(x, z, t);
        const [px, py, s] = project(x, -y, z);
        if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
        const twinkle = 0.6 + 0.4 * Math.sin(t * 2 + c * 1.7 + r * 2.3);
        const size = Math.max(0.7, s * 2.4);
        ctx.fillStyle = `rgba(${60 + Math.min(80, Math.max(0, y) * 0.4)},${170 + Math.min(70, Math.max(0, y) * 0.3)},255,${0.9 * fade * twinkle})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 前景散景光點，緩慢漂浮
    for (const b of bokeh) {
      if (!reduceMotion) {
        b.x += b.vx; b.y += b.vy;
        if (b.y < -20) { b.y = h + 20; b.x = Math.random() * w; }
        if (b.x < -20) b.x = w + 20; else if (b.x > w + 20) b.x = -20;
      }
      const a = b.a * (0.6 + 0.4 * Math.sin(t * 0.8 + b.p));
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, `rgba(80,170,255,${a})`);
      g.addColorStop(1, 'rgba(80,170,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  new ResizeObserver(() => {
    resize();
    if (reduceMotion) frame(0);
  }).observe(canvas);
  requestAnimationFrame(frame);
})();
