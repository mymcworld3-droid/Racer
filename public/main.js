// ======================= WebSocket =======================
const WS_URL = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host;
const ws = new WebSocket(WS_URL);

// ======================= Canvas / World =======================
let WORLD = { width: 24000, height: 18000 };
const camera = { x: 0, y: 0 };

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

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
  bmp: null,          // 已縮放到 WORLD 的 ImageBitmap
  mw: 0, mh: 0,       // mask 尺寸
  mdata: null         // mask 的像素資料
};
const TRACK_SRC = 'track2.png'; // 檔名自行對應
(async function loadTrack() {
  const img = new Image();
  img.src = TRACK_SRC;

  // 安全載入（相容舊瀏覽器）
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  // A) 一次性縮放到 WORLD 尺寸（畫到離屏 canvas）
  const worldCV = document.createElement('canvas');
  worldCV.width = WORLD.width;
  worldCV.height = WORLD.height;
  worldCV.getContext('2d').drawImage(img, 0, 0, WORLD.width, WORLD.height);

  // 建立世界尺寸的可繪位圖（drawImage 時只需裁切，不再縮放）
  if (window.createImageBitmap) {
    TRACK.bmp = await createImageBitmap(worldCV);
  } else {
    // 極少數環境沒有 createImageBitmap，用 <img> 當替代
    const tmp = new Image();
    tmp.src = worldCV.toDataURL();
    await new Promise(r => (tmp.onload = r));
    TRACK.bmp = tmp;
  }

  // B) 低解析度碰撞 mask（大幅減少像素取樣成本）
  const mw = Math.min(1024, WORLD.width);
  const mh = Math.round(WORLD.height * (mw / WORLD.width));
  const cv = document.createElement('canvas');
  cv.width = mw; cv.height = mh;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(worldCV, 0, 0, mw, mh);
  TRACK.mw = mw; TRACK.mh = mh;
  TRACK.mdata = cx.getImageData(0, 0, mw, mh).data;

  TRACK.ready = true;

  // C) ★ 圖就緒後才把車放到路上
  let sx = WORLD.width * 0.5, sy = WORLD.height * 0.5;
  for (let dx = 0; dx < Math.min(2000, WORLD.width); dx += 10) {
    if (isOnRoad(sx + dx, sy)) { car.x = sx + dx; car.y = sy; break; }
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

// 把賽道圖畫到世界（會跟著相機捲動）
function drawTrackImage() {
  if (!TRACK.ready) return;
  ctx.drawImage(
    TRACK.bmp,
    camera.x, camera.y, VIEW.w, VIEW.h, // source rect (世界)
    0, 0, VIEW.w, VIEW.h                // dest rect (螢幕)
  );
}


// 將世界座標映到賽道圖像素座標
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

  // 你的圖是灰路、綠草：抓「中等亮度的灰」當柏油
  const isGray = Math.abs(r - g) < 18 && Math.abs(g - b) < 18;
  const Y = (r + g + b) / 3;
  return isGray && Y > 70 && Y < 200;
}

// 放出生點在路上（載入完成才找得到）
let sx = WORLD.width * 0.5, sy = WORLD.height * 0.5;
for (let dx = 0; dx < 2000; dx += 10) {
  if (isOnRoad(sx + dx, sy)) { car.x = sx + dx; car.y = sy; break; }
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
function loop() {
  // Input
  // === 搖桿只影響移動方向；車身角度不跟搖桿 ===
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
    // 1) 新輸入單位向量
    const ix = mx / len, iy = my / len;

    // 2) 角度（若你要車身跟搖桿，保留；不需要就刪掉下一行）
    car.angle = Math.atan2(iy, ix);

    // 3) 方向向量平滑：(舊 + 新) / 2（用 DIR_BLEND 權重）  
    dirX = dirX * (1 - DIR_BLEND) + ix * DIR_BLEND;
    dirY = dirY * (1 - DIR_BLEND) + iy * DIR_BLEND;
    const d = Math.hypot(dirX, dirY) || 1;
    dirX /= d; dirY /= d;

    // 4) 目標速度 = maxSpeed * 油門(搖桿大小)
    const throttle = Math.min(1, len);
    const targetSpeed = car.maxSpeed * throttle;

    // 與目前移動方向的夾角，用來判定煞車強度
    const align = ix * dirX + iy * dirY; // [-1..1]，<0 代表反向
    const brakePerFrame  = (1 - car.friction) * (align < 0 ? 6 : 2); // 反向時煞更重

    if (car.speed < targetSpeed) {
      // 加速（用你原本的 accel）
      car.speed = Math.min(targetSpeed, car.speed + car.accel);
    } else {
      // 減速（靠「主動煞車」，比惰性大）
      car.speed = Math.max(targetSpeed, car.speed - brakePerFrame);
    }
  } else {
    // 沒輸入 → 惰性滑行（用原本的摩擦）
    car.speed *= car.friction;
    // 避免超小殘速
    if (car.speed < 0.01) car.speed = 0;
  }

  // 用平滑後的移動向量整合位置
  car.x += dirX * car.speed;
  car.y += dirY * car.speed;
  
  // 不在路面上 → 限速 + 更強的耗速（砂石/草地效果）
  if (TRACK.ready && !isOnRoad(car.x, car.y)) {
    const OFFROAD_LIMIT = 5;        // 路外最高速
    car.speed = Math.min(car.speed, OFFROAD_LIMIT);
    car.speed *= 0.92;                // 每幀多吃一點速度
  }
  
  // Clamp to world
  car.x = Math.max(car.width / 2, Math.min(WORLD.width - car.width / 2, car.x));
  car.y = Math.max(car.height / 2, Math.min(WORLD.height - car.height / 2, car.y));

  // Obstacles collision (simple bounce + small separation)
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
  //drawGrid(100);
  drawTrackImage();
  drawWorldBorder();

  for (const o of obstacles) {
    const vis =
      o.x + o.r >= camera.x &&
      o.x - o.r <= camera.x + VIEW.w &&
      o.y + o.r >= camera.y &&
      o.y - o.r <= camera.y + VIEW.h;
    //if (vis) drawObstacle(o);
  }

  drawCar(car.x, car.y, car.angle, car.color);

  for (const id in players) {
    if (id === myId) continue;
    const p = players[id];
    drawCar(p.x, p.y, p.angle, p.color);
  }

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
  } else if (msg.type === 'join') {
    players[msg.id] = msg.player;
  } else if (msg.type === 'sync') {
    players = msg.players || players;
  } else if (msg.type === 'leave') {
    delete players[msg.id];
  }
};
