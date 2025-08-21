// ======================= On-screen Debug HUD =======================
const DBG = [];
function dbg(...a){
  const s = a.map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ');
  DBG.push(s); if (DBG.length > 14) DBG.shift();
  console.log('[racer]', s);
}
window.addEventListener('error', e => dbg('JS error:', e.message));
window.addEventListener('unhandledrejection', e => dbg('Promise reject:', e.reason?.message || e.reason));

// ======================= WebSocket =======================
const WS_URL = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host;
const ws = new WebSocket(WS_URL);

// ======================= Canvas / World =======================
let WORLD = { width: 32000, height: 24000 };
const camera = { x: 0, y: 0 };

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// HiDPI
(function () {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width, cssH = canvas.height;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
})();

const VIEW = {
  get w() { return canvas.clientWidth; },
  get h() { return canvas.clientHeight; }
};

// ======================= State =======================
// ===== Track image (快取成世界大小 + 低解析度 mask) =====
const TRACK = {
  ready: false,
  bmp: null,          // 快取位圖（縮到安全尺寸）
  bw: 0, bh: 0,       // 位圖實際寬高
  scale: 1,           // = bw/WORLD.width = bh/WORLD.height
  mw: 0, mh: 0,       // 低解析度 mask 尺寸
  mdata: null         // mask 像素
};
const TRACK_SRC = 'track2.png';

(async function loadTrack() {
  dbg('loadTrack start', TRACK_SRC, 'world=', WORLD.width, 'x', WORLD.height);

  const img = new Image();
  img.addEventListener('load', () => dbg('img loaded', img.naturalWidth, 'x', img.naturalHeight));
  img.addEventListener('error', () => dbg('img ERROR loading:', TRACK_SRC));
  img.src = TRACK_SRC;

  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  } catch (e) {
    dbg('loadTrack failed:', e?.message || e);
    return;
  }

  // 同時限制「面積」與「單邊尺寸」
  const MAX_AREA = 4096 * 4096;   // ~16MP（可依裝置調整）
  const MAX_DIM  = 4096;          // 單邊上限
  const worldArea = WORLD.width * WORLD.height;

  const sArea = Math.min(1, Math.sqrt(MAX_AREA / worldArea));
  const sDim  = Math.min(1, MAX_DIM / WORLD.width, MAX_DIM / WORLD.height);
  const s     = Math.min(sArea, sDim);

  // 產生縮好的世界圖（之後只做裁切，不再縮放）
  const bw = Math.max(1, Math.floor(WORLD.width  * s));
  const bh = Math.max(1, Math.floor(WORLD.height * s));
  dbg('scaled bitmap size', bw, 'x', bh, 'scale=', s.toFixed(6), 'createIB=', !!window.createImageBitmap);

  const worldCV = document.createElement('canvas');
  worldCV.width = bw; worldCV.height = bh;
  const wg = worldCV.getContext('2d');
  wg.imageSmoothingEnabled = false;
  wg.drawImage(img, 0, 0, bw, bh);

  try {
    TRACK.bmp = (window.createImageBitmap)
      ? await createImageBitmap(worldCV)
      : (() => { const t = new Image(); t.src = worldCV.toDataURL(); return t; })();
  } catch (e) {
    dbg('createImageBitmap failed, fallback img', e?.message || e);
    const t = new Image(); t.src = worldCV.toDataURL();
    await new Promise(r => t.onload = r);
    TRACK.bmp = t;
  }

  TRACK.bw = bw; TRACK.bh = bh; TRACK.scale = s;

  // 低解析度 mask（再縮一階，專供像素取樣）
  const mw = Math.min(1024, bw);
  const mh = Math.round(bh * (mw / bw));
  const cv = document.createElement('canvas');
  cv.width = mw; cv.height = mh;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = false;
  cx.drawImage(worldCV, 0, 0, mw, mh);
  TRACK.mw = mw; TRACK.mh = mh;
  TRACK.mdata = cx.getImageData(0, 0, mw, mh).data;

  TRACK.ready = true;
  dbg('track ready bw/bh/scale =', TRACK.bw, TRACK.bh, TRACK.scale, 'mask=', TRACK.mw, 'x', TRACK.mh);

  // ★ 圖就緒後再把車放到「有路」的位置
  const cxWorld = WORLD.width * 0.5, cyWorld = WORLD.height * 0.5;
  for (let dx = 0; dx < Math.min(3000, WORLD.width); dx += 10) {
    if (isOnRoad(cxWorld + dx, cyWorld)) { 
      car.x = cxWorld + dx; 
      car.y = cyWorld; 
      dbg('spawn at', car.x, car.y); 
      break; 
    }
  }
  updateCamera();
})();

const car = {
  x: 400, y: 300,
  angle: 0, speed: 0,
  maxSpeed: 10, accel: 0.15, friction: 0.98,
  width: 40, height: 70,
  color: '#ff4757'
};
// 方向向量（用來做 (舊 + 新) / 2 的平滑）
let dirX = Math.cos(car.angle);
let dirY = Math.sin(car.angle);

const DIR_BLEND = 0.05;

let obstacles = [];
let players = {};
let myId = null;

// ======================= Helpers / Drawing =======================
function updateCamera() {
  camera.x = Math.max(0, Math.min(car.x - VIEW.w / 2, WORLD.width - VIEW.w));
  camera.y = Math.max(0, Math.min(car.y - VIEW.h / 2, WORLD.height - VIEW.h));
}
function worldToScreen(wx, wy) { return { x: wx - camera.x, y: wy - camera.y }; }

function drawTrackImage() {
  if (!TRACK.ready || !TRACK.bmp) { /*dbg('track not ready');*/ return; }
  const s = TRACK.scale;
  let sx = Math.max(0, Math.min(TRACK.bw - VIEW.w * s, camera.x * s));
  let sy = Math.max(0, Math.min(TRACK.bh - VIEW.h * s, camera.y * s));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(TRACK.bmp, sx, sy, VIEW.w * s, VIEW.h * s, 0, 0, VIEW.w, VIEW.h);
}

// 將世界座標映到賽道圖像素座標（用低解析度 mask）
function worldToTrackUV(wx, wy) {
  const u = Math.floor(wx * (TRACK.mw / WORLD.width));
  const v = Math.floor(wy * (TRACK.mh / WORLD.height));
  return { u, v };
}
function isOnRoad(wx, wy) {
  if (!TRACK.ready) return true;
  const { u, v } = worldToTrackUV(wx, wy);
  if (u < 0 || v < 0 || u >= TRACK.mw || v >= TRACK.mh) return false;

  const i = (v * TRACK.mw + u) * 4;
  const r = TRACK.mdata[i], g = TRACK.mdata[i+1], b = TRACK.mdata[i+2], a = TRACK.mdata[i+3];
  if (a < 16) return false;

  // 灰路 / 綠草：抓中亮度灰
  const isGray = Math.abs(r - g) < 18 && Math.abs(g - b) < 18;
  const Y = (r + g + b) / 3;
  return isGray && Y > 70 && Y < 200;
}

function drawGrid(step = 100) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;

  const viewLeft = camera.x, viewTop = camera.y;
  const viewRight = camera.x + VIEW.w, viewBottom = camera.y + VIEW.h;
  const startX = Math.floor(viewLeft / step) * step;
  const startY = Math.floor(viewTop / step) * step;

  for (let x = startX; x <= viewRight; x += step) {
    const s = worldToScreen(x, 0);
    ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, VIEW.h); ctx.stroke();
  }
  for (let y = startY; y <= viewBottom; y += step) {
    const s = worldToScreen(0, y);
    ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(VIEW.w, s.y); ctx.stroke();
  }
  ctx.restore();
}

function drawWorldBorder() {
  ctx.save();
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 3;
  const tl = worldToScreen(0, 0);
  const br = worldToScreen(WORLD.width, WORLD.height);
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.restore();
}

const ANGLE_OFFSET = Math.PI / 2;
function drawCar(wx, wy, angle, color) {
  const s = worldToScreen(wx, wy);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate((angle || 0) + ANGLE_OFFSET);
  ctx.fillStyle = color;
  ctx.fillRect(-car.width / 2, -car.height / 2, car.width, car.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-car.width / 4, -car.height / 2 + 10, car.width / 2, car.height / 2);
  ctx.restore();
}
function drawObstacle(o) {
  const s = worldToScreen(o.x, o.y);
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.x, s.y, o.r, 0, Math.PI * 2);
  ctx.fillStyle = '#0af';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  ctx.restore();
}

function drawHud(){
  const pad = 8, line = 14, w = 460, h = DBG.length*line + pad*2;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(10,10,w,h);
  ctx.font = '12px monospace'; ctx.fillStyle = '#b6f';
  for(let i=0;i<DBG.length;i++) ctx.fillText(DBG[i], 18, 10+pad+i*line+10);
  ctx.restore();
}

// ======================= Input: Joystick + Keyboard =======================
const joystick = document.getElementById('joystick');
const stick = document.getElementById('stick');
const joy = { dx: 0, dy: 0, active: false };
let joyRect = joystick.getBoundingClientRect();
window.addEventListener('resize', () => { joyRect = joystick.getBoundingClientRect(); });

function updateJoystick(e) {
  let x, y;
  if (e.touches && e.touches[0]) {
    x = e.touches[0].clientX - joyRect.left - 55;
    y = e.touches[0].clientY - joyRect.top - 55;
  } else {
    x = e.clientX - joyRect.left - 55;
    y = e.clientY - joyRect.top - 55;
  }
  const len = Math.hypot(x, y), maxR = 45;
  if (len > maxR) { x *= maxR / len; y *= maxR / len; }
  stick.style.left = `${x + 35}px`; stick.style.top = `${y + 35}px`;
  joy.dx = x / maxR; joy.dy = y / maxR; joy.active = true;
}
function resetJoystick() {
  stick.style.left = '35px'; stick.style.top = '35px';
  joy.dx = 0; joy.dy = 0; joy.active = false;
}
joystick.addEventListener('touchstart', updateJoystick);
joystick.addEventListener('touchmove', updateJoystick);
joystick.addEventListener('touchend', resetJoystick);
joystick.addEventListener('mousedown', e => { joyRect = joystick.getBoundingClientRect(); updateJoystick(e); });
joystick.addEventListener('mousemove', e => { if (joy.active) updateJoystick(e); });
joystick.addEventListener('mouseup', resetJoystick);
joystick.addEventListener('mouseleave', resetJoystick);
document.body.addEventListener('mouseup', resetJoystick);

// 鍵盤
const keys = {};
window.addEventListener('keydown', e => { keys[e.key] = true; });
window.addEventListener('keyup', e => { keys[e.key] = false; });

// ======================= Game Loop =======================
let lastMoveSent = 0;
dbg('main.js boot');

function loop() {
  // Input
  let mx = 0, my = 0;
  if (joy.active) { mx = joy.dx; my = joy.dy; }
  else {
    if (keys['ArrowLeft'] || keys['a']) mx -= 1;
    if (keys['ArrowRight']|| keys['d']) mx += 1;
    if (keys['ArrowUp']   || keys['w']) my -= 1;
    if (keys['ArrowDown'] || keys['s']) my += 1;
  }

  const len = Math.hypot(mx, my);
  if (len > 0.2) {
    const ix = mx / len, iy = my / len;
    car.angle = Math.atan2(iy, ix);

    // 平滑方向向量
    dirX = dirX * (1 - DIR_BLEND) + ix * DIR_BLEND;
    dirY = dirY * (1 - DIR_BLEND) + iy * DIR_BLEND;
    const d = Math.hypot(dirX, dirY) || 1;
    dirX /= d; dirY /= d;

    const throttle = Math.min(1, len);
    const targetSpeed = car.maxSpeed * throttle;
    const align = ix * dirX + iy * dirY;
    const brakePerFrame  = (1 - car.friction) * (align < 0 ? 6 : 2);

    if (car.speed < targetSpeed) {
      car.speed = Math.min(targetSpeed, car.speed + car.accel);
    } else {
      car.speed = Math.max(targetSpeed, car.speed - brakePerFrame);
    }
  } else {
    car.speed *= car.friction;
    if (car.speed < 0.01) car.speed = 0;
  }

  // Move
  car.x += dirX * car.speed;
  car.y += dirY * car.speed;

  // 路外限速/耗速
  if (TRACK.ready && !isOnRoad(car.x, car.y)) {
    const OFFROAD_LIMIT = 5;
    car.speed = Math.min(car.speed, OFFROAD_LIMIT);
    car.speed *= 0.92;
  }

  // Clamp to world
  car.x = Math.max(car.width / 2, Math.min(WORLD.width - car.width / 2, car.x));
  car.y = Math.max(car.height / 2, Math.min(WORLD.height - car.height / 2, car.y));

  // Obstacles collision (簡單)
  for (const o of obstacles) {
    const dx = car.x - o.x, dy = car.y - o.y;
    const dist = Math.hypot(dx, dy);
    const minD = o.r + car.width / 2;
    if (dist < minD) {
      car.speed = -car.maxSpeed / 2;
      const nx = dx / (dist || 1), ny = dy / (dist || 1);
      const push = (minD - dist) + 0.5;
      car.x += nx * push; car.y += ny * push;
    }
  }

  updateCamera();

  // Draw
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  drawTrackImage();
  drawWorldBorder();

  // 其它玩家（若有）
  drawCar(car.x, car.y, car.angle, car.color);
  for (const id in players) {
    if (id === myId) continue;
    const p = players[id];
    drawCar(p.x, p.y, p.angle, p.color);
  }

  // HUD
  drawHud();

  // Network (throttle 50ms)
  const now = performance.now();
  if (ws.readyState === WebSocket.OPEN && myId && now - lastMoveSent > 50) {
    ws.send(JSON.stringify({ type: 'move', x: car.x, y: car.y, angle: car.angle }));
    lastMoveSent = now;
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ======================= WS Messages =======================
ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type === 'init') {
    myId = msg.id;
    players = msg.players || {};
    obstacles = msg.obstacles || [];
    if (msg.world && msg.world.width && msg.world.height) {
      WORLD = { width: msg.world.width, height: msg.world.height };
    }
    if (players[myId]) {
      car.x = players[myId].x;
      car.y = players[myId].y;
    }
    dbg('ws init: players=', Object.keys(players).length, 'obs=', obstacles.length);
  } else if (msg.type === 'join') {
    players[msg.id] = msg.player;
    dbg('ws join', msg.id);
  } else if (msg.type === 'sync') {
    players = msg.players || players;
  } else if (msg.type === 'leave') {
    delete players[msg.id];
    dbg('ws leave', msg.id);
  }
};
