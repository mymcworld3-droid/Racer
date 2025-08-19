// --- sanity check ---
console.log("[racer] main.js loaded");
window.addEventListener("error", e => console.error("[racer] JS error:", e.message));

// ======================= WebSocket =======================
const WS_URL = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host;
const ws = new WebSocket(WS_URL);
ws.addEventListener('open',  () => console.log('[racer] ws open:', WS_URL));
ws.addEventListener('error', (e) => console.warn('[racer] ws error:', e));
ws.addEventListener('close', () => console.warn('[racer] ws closed'));

// ======================= Canvas & DPR =======================
const WORLD  = { width: 4000, height: 3000 };
const camera = { x: 0, y: 0 };

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

(function fixDPR() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width;   // e.g. 800
  const cssH = canvas.height;  // e.g. 600
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 之後一率用 CSS 像素作畫
})();
const VIEW = { get w(){ return canvas.clientWidth; }, get h(){ return canvas.clientHeight; } };

// ======================= Player / State =======================
const car = {
  x: 400, y: 300,
  angle: 0, speed: 0,
  maxSpeed: 5, accel: 0.15, friction: 0.98,
  width: 40, height: 70,
  color: '#ff4757'
};
let obstacles = [];   // 伺服器下發
let players   = {};   // 其他玩家（伺服器權威）
let myId      = null;
// 飄移參數
const DRIFT = {
  normal: 0.85,   // 平常保留多少"側向"速度(0~1，越大越滑)
  drift:  0.98,   // 飄移時保留的側向速度(越接近1越滑)
  thresholdSpeed: 350, // 速度到這值就能完全觸發飄移(像素/秒)
  skidRightVel: 80     // 側滑超過這值就畫輪胎痕
};

// 讓車用"速度向量"移動（飄移需要）
car.vx = 0;
car.vy = 0;
car.engineAccel = 900;  // 引擎前進加速度(px/s^2)
car.drag        = 1.8;  // 空氣阻力(每秒)
car.steerSpeed  = 3.2;  // 方向盤反應(弧度/秒)

// ======================= Helpers / Drawing =======================
function updateCamera() {
  camera.x = Math.max(0, Math.min(car.x - VIEW.w / 2, WORLD.width  - VIEW.w));
  camera.y = Math.max(0, Math.min(car.y - VIEW.h / 2, WORLD.height - VIEW.h));
}
function worldToScreen(wx, wy) { return { x: wx - camera.x, y: wy - camera.y }; }
//飄移函式
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
function shortestAngle(a){
  // 把角度映射到(-π, π]
  return ((a + Math.PI) % (Math.PI * 2)) - Math.PI;
}

function drawGrid(step = 100) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;

  const viewLeft = camera.x, viewTop = camera.y;
  const viewRight = camera.x + VIEW.w, viewBottom = camera.y + VIEW.h;
  const startX = Math.floor(viewLeft / step) * step;
  const startY = Math.floor(viewTop  / step) * step;

  for (let x = startX; x <= viewRight; x += step) {
    const s = worldToScreen(x, 0);
    ctx.beginPath();
    ctx.moveTo(s.x, 0);
    ctx.lineTo(s.x, VIEW.h);
    ctx.stroke();
  }
  for (let y = startY; y <= viewBottom; y += step) {
    const s = worldToScreen(0, y);
    ctx.beginPath();
    ctx.moveTo(0, s.y);
    ctx.lineTo(VIEW.w, s.y);
    ctx.stroke();
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

const ANGLE_OFFSET = Math.PI / 2; // 0rad 朝右 -> 畫圖時補 90° 變朝上
function drawCar(wx, wy, angle, color) {
  const s = worldToScreen(wx, wy);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate((angle || 0) + ANGLE_OFFSET);
  ctx.fillStyle = color;
  ctx.fillRect(-car.width/2, -car.height/2, car.width, car.height);
  // 小車窗
  ctx.fillStyle = "#fff";
  ctx.fillRect(-car.width/4, -car.height/2 + 10, car.width/2, car.height/2);
  ctx.restore();
}
function drawObstacle(obs) {
  const s = worldToScreen(obs.x, obs.y);
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.x, s.y, obs.r, 0, Math.PI*2);
  ctx.fillStyle = "#0af";
  ctx.fill();
  ctx.restore();
}

// ======================= Input: Joystick + Keyboard =======================
const joystick = document.getElementById('joystick');
const stick    = document.getElementById('stick');
const joy      = { dx: 0, dy: 0, active: false };
let joyRect    = joystick.getBoundingClientRect();

window.addEventListener('resize', () => { joyRect = joystick.getBoundingClientRect(); });

function updateJoystick(e) {
  let x, y;
  if (e.touches && e.touches[0]) {
    x = e.touches[0].clientX - joyRect.left - 55;
    y = e.touches[0].clientY - joyRect.top  - 55;
  } else {
    x = e.clientX - joyRect.left - 55;
    y = e.clientY - joyRect.top  - 55;
  }
  const len = Math.hypot(x, y), maxR = 45;
  if (len > maxR) { x *= maxR / len; y *= maxR / len; }
  stick.style.left = `${x+35}px`; stick.style.top = `${y+35}px`;
  joy.dx = x / maxR; joy.dy = y / maxR; joy.active = true;
}
function resetJoystick() {
  stick.style.left = "35px"; stick.style.top = "35px";
  joy.dx = 0; joy.dy = 0; joy.active = false;
}
joystick.addEventListener('touchstart', updateJoystick);
joystick.addEventListener('touchmove',  updateJoystick);
joystick.addEventListener('touchend',   resetJoystick);
joystick.addEventListener('mousedown',  e => { joyRect = joystick.getBoundingClientRect(); updateJoystick(e); });
joystick.addEventListener('mousemove',  e => { if (joy.active) updateJoystick(e); });
joystick.addEventListener('mouseup',    resetJoystick);
joystick.addEventListener('mouseleave', resetJoystick);
document.body.addEventListener('mouseup', resetJoystick);

// 鍵盤備援
const keys = {};
window.addEventListener("keydown", e => { keys[e.key] = true; });
window.addEventListener("keyup",   e => { keys[e.key] = false; });

// ======================= Game Loop =======================
let lastMoveSent = 0;
function loop() {
  // === 飄移版物理更新（含方向、加速、阻力、側滑） ===
  const now = performance.now();
  loop._last = loop._last ?? now;
  const dt = Math.min(0.033, (now - loop._last) / 1000 || 0.016);
  loop._last = now;

  // 1) 讀取操控輸入：類比搖桿 + 鍵盤備援
  let mx = 0, my = 0;
  if (joy.active) { mx = joy.dx; my = joy.dy; }
  else {
    if (keys["ArrowLeft"] || keys["a"])  mx -= 1;
    if (keys["ArrowRight"]|| keys["d"])  mx += 1;
    if (keys["ArrowUp"]   || keys["w"])  my -= 1;
    if (keys["ArrowDown"] || keys["s"])  my += 1;
  }
  const inLen = Math.hypot(mx, my);
  const throttle = clamp(inLen, 0, 1);

  // 2) 方向：用「目標方向 - 車頭」的差值當轉向輸入，速度越快轉向越敏感
  let steerInput = 0;
  if (inLen > 0.1) {
    const desired = Math.atan2(my, mx);
    const diff    = shortestAngle(desired - car.angle);
    steerInput = clamp(diff / (Math.PI / 2), -1, 1); // -1~1
  }
  const speed = Math.hypot(car.vx, car.vy);
  const speedFactor = 0.5 + Math.min(1, speed / 400); // 速度越快越好轉（可調）
  car.angle += steerInput * car.steerSpeed * speedFactor * dt;

  // 3) 前進推力（只沿車頭方向加速）
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  car.vx += fx * car.engineAccel * throttle * dt;
  car.vy += fy * car.engineAccel * throttle * dt;

  // 4) 空氣阻力（對整體速度）
  car.vx *= (1 - car.drag * dt);
  car.vy *= (1 - car.drag * dt);

// 5) 分解成「前進/側向」速度，側向套用飄移係數
  const rx = -Math.sin(car.angle), ry =  Math.cos(car.angle); // 右側單位向量
  let fwdVel  = car.vx * fx + car.vy * fy;  // 前進分量
  let sideVel = car.vx * rx + car.vy * ry;  // 側向分量（越大=越側滑）

  // 飄移強度：速度高 & 轉向大 → 飄得更兇
  const driftStrength = clamp((speed / DRIFT.thresholdSpeed) * (0.3 + 0.7 * Math.abs(steerInput)), 0, 1);
  const driftFactor   = DRIFT.normal + (DRIFT.drift - DRIFT.normal) * driftStrength;

  // 這行就是「飄移」的核心：保留更多側向速度（數值越接近1越滑）
  sideVel *= driftFactor;

  // 6) 合成回速度向量
  car.vx = fx * fwdVel + rx * sideVel;
  car.vy = fy * fwdVel + ry * sideVel;

  // 7) 整合位置
  car.x += car.vx * dt;
  car.y += car.vy * dt;

  // 8) 世界邊界 & 簡單障礙碰撞反彈
  car.x = Math.max(car.width/2,  Math.min(WORLD.width  - car.width/2,  car.x));
  car.y = Math.max(car.height/2, Math.min(WORLD.height - car.height/2, car.y));

  for (const o of obstacles) {
    const dx = car.x - o.x, dy = car.y - o.y;
    const dist = Math.hypot(dx, dy);
    const minD = o.r + car.width/2;
    if (dist < minD) {
      // 推離開
      const nx = dx / (dist || 1), ny = dy / (dist || 1);
      const push = (minD - dist) + 0.5;
      car.x += nx * push;
      car.y += ny * push;
      // 反射一部分速度（降低速度看起來像撞到）
      const vn = car.vx * nx + car.vy * ny;
      car.vx -= vn * nx * 1.5;
      car.vy -= vn * ny * 1.5;
    }
  }

  // 9) 飄移時畫輪胎痕（簡易版）
  const sideSpeedAbs = Math.abs(sideVel);
  if (sideSpeedAbs > DRIFT.skidRightVel && speed > 120) {
    const rearX = car.x - fx * (car.height * 0.35);
    const rearY = car.y - fy * (car.height * 0.35);
    const leftX = rearX - rx * (car.width * 0.28);
    const leftY = rearY - ry * (car.width * 0.28);
    const rightX = rearX + rx * (car.width * 0.28);
    const rightY = rearY + ry * (car.width * 0.28);

    const L = worldToScreen(leftX,  leftY);
    const R = worldToScreen(rightX, rightY);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath(); ctx.arc(L.x, L.y, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(R.x, R.y, 2, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  updateCamera();

  // draw
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  drawGrid(100);
  drawWorldBorder();
  
  // 簡單碰撞反彈
  // 障礙物：先做碰撞，再判斷是否在畫面內再畫
  for (const o of obstacles) {
    // 碰撞（世界座標）
    const dx = car.x - o.x, dy = car.y - o.y;
    if (Math.hypot(dx, dy) < o.r + car.width / 2) {
      car.speed = -car.maxSpeed / 2;
    }

    // 僅當在可視範圍內才繪製（避免白畫）
    const vis =
      o.x + o.r >= camera.x &&
      o.x - o.r <= camera.x + VIEW.w &&
      o.y + o.r >= camera.y &&
      o.y - o.r <= camera.y + VIEW.h;

    if (vis) drawObstacle(o);
  }

  // 本地車
  drawCar(car.x, car.y, car.angle, car.color);

  // 其他玩家
  for (const id in players) {
    if (id === myId) continue; // 避免自己畫兩次
    const p = players[id];
    drawCar(p.x, p.y, p.angle, p.color);
  }

  // 傳輸節流（50ms）
  const now = performance.now();
  if (ws.readyState === WebSocket.OPEN && myId && now - lastMoveSent > 50) {
    ws.send(JSON.stringify({ type: 'move', x: car.x, y: car.y, angle: car.angle }));
    lastMoveSent = now;
  }

  requestAnimationFrame(loop);
}
// 立即啟動本地迴圈（就算 WS 沒連上也能玩）
requestAnimationFrame(loop);

// ======================= WS 消息處理（單一 handler） =======================
ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type === 'init') {
    myId = msg.id;
    players = msg.players || {};
    obstacles = msg.obstacles || [];
    if (players[myId]) {
      car.x = players[myId].x;
      car.y = players[myId].y;
      car.angle = players[myId].angle || 0;
    }
  } else if (msg.type === 'join') {
    players[msg.id] = msg.player;
  } else if (msg.type === 'sync') {
    players = msg.players || players;
  } else if (msg.type === 'leave') {
    delete players[msg.id];
  }
};
