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
let WORLD = { width: 8000, height: 6000 };
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
// ===== Track image (快取成世界大小 + 精準取樣) =====
const TRACK = {
  ready: false,
  bmp: null,          // 縮到安全尺寸後的位圖（用來畫）
  canvas: null,       // 同一張縮圖的 Canvas（用來取樣顏色）
  bw: 0, bh: 0,       // 位圖寬高
  scale: 1,           // = bw/WORLD.width = bh/WORLD.height
  // 1x1 取樣畫布
  pickCV: null,
  pick: null
};
const TRACK_SRC = 'track2.png';

(async function loadTrack() {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = TRACK_SRC; });

  // 限制縮圖大小：同時顧單邊與面積（避免爆記憶體/卡 GPU）
  const MAX_AREA = 4096 * 4096;
  const MAX_DIM  = 4096;
  const worldArea = WORLD.width * WORLD.height;
  const sArea = Math.min(1, Math.sqrt(MAX_AREA / worldArea));
  const sDim  = Math.min(1, MAX_DIM / WORLD.width, MAX_DIM / WORLD.height);
  const s     = Math.min(sArea, sDim);

  const bw = Math.max(1, Math.floor(WORLD.width  * s));
  const bh = Math.max(1, Math.floor(WORLD.height * s));

  // 把原圖縮成「世界縮圖」一次到位
  const worldCV = document.createElement('canvas');
  worldCV.width = bw; worldCV.height = bh;
  const wg = worldCV.getContext('2d');
  wg.imageSmoothingEnabled = false;
  wg.drawImage(img, 0, 0, bw, bh);

  // 用縮圖做繪製來源
  TRACK.bmp = (window.createImageBitmap)
    ? await createImageBitmap(worldCV)
    : (() => { const t = new Image(); t.src = worldCV.toDataURL(); return t; })();

  // ↓↓↓ 關鍵：把縮圖 Canvas 本體保留，用來「精準取樣」 ↓↓↓
  TRACK.canvas = worldCV;

  // 準備 1×1 取樣畫布
  TRACK.pickCV = document.createElement('canvas');
  TRACK.pickCV.width = 1; TRACK.pickCV.height = 1;
  TRACK.pick = TRACK.pickCV.getContext('2d', { willReadFrequently: true });
  TRACK.pick.imageSmoothingEnabled = false;

  TRACK.bw = bw; TRACK.bh = bh; TRACK.scale = s;
  TRACK.ready = true;

  // 把車丟到第一個找到的「路」上
  const cxWorld = WORLD.width * 0.5, cyWorld = WORLD.height * 0.5;
  for (let dx = 0; dx < Math.min(3000, WORLD.width); dx += 10) {
    if (isOnRoad(cxWorld + dx, cyWorld)) { car.x = cxWorld + dx; car.y = cyWorld; break; }
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

// 把賽道圖畫到世界（會跟著相機捲動）— 用整數像素裁切避免位移
function drawTrackImage() {
  if (!TRACK.ready || !TRACK.bmp) return;
  const s = TRACK.scale;
  const sw = Math.round(VIEW.w * s);
  const sh = Math.round(VIEW.h * s);
  const sx = Math.max(0, Math.min(TRACK.bw - sw, Math.round(camera.x * s)));
  const sy = Math.max(0, Math.min(TRACK.bh - sh, Math.round(camera.y * s)));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(TRACK.bmp, sx, sy, sw, sh, 0, 0, VIEW.w, VIEW.h);
}

// 將世界座標映到賽道圖像素座標（用低解析度 mask）
function worldToTrackUV(wx, wy) {
  const u = Math.floor(wx * (TRACK.mw / WORLD.width));
  const v = Math.floor(wy * (TRACK.mh / WORLD.height));
  return { u, v };
}
// 從與畫面相同的縮圖上「取 1 像素」判斷是否是柏油
function isOnRoad(wx, wy) {
  if (!TRACK.ready || !TRACK.canvas || !TRACK.pick) return true;

  // 世界座標 → 縮圖座標（與 drawTrackImage 同一把尺）
  const s = TRACK.scale;
  let u = Math.round(wx * s);
  let v = Math.round(wy * s);
  if (u < 0 || v < 0 || u >= TRACK.bw || v >= TRACK.bh) return false;

  // 在 1×1 取樣畫布上抓顏色
  TRACK.pick.clearRect(0, 0, 1, 1);
  TRACK.pick.drawImage(TRACK.canvas, u, v, 1, 1, 0, 0, 1, 1);
  const d = TRACK.pick.getImageData(0, 0, 1, 1).data;
  const r = d[0], g = d[1], b = d[2], a = d[3];
  if (a < 8) return false;

  // 「灰路」判斷：低飽和 + 中亮度（比原本 mask 更貼著你看到的畫面）
  const maxv = Math.max(r, g, b), minv = Math.min(r, g, b);
  const sat  = maxv - minv;
  const Y    = (r + g + b) / 3;
  const isGray = sat < 28;          // 放寬飽和度（避免因縮放失真）
  const midY   = (Y > 60 && Y < 210);
  return isGray && midY;
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
