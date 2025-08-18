
// ★ 世界尺寸（你可改大一點）
const WORLD = { width: 4000, height: 3000 };

// ★ 攝影機：把玩家放中央、計算可見範圍左上角
const camera = { x: 0, y: 0 };

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ★ HiDPI：讓畫面不要小小糊糊的
(function fixDPR() {
  const dpr = window.devicePixelRatio || 1;
  // CSS 尺寸（index.html 寫的 800x600）：
  const cssW = canvas.width;
  const cssH = canvas.height;
  // 設置真實像素尺寸並縮放
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
})();

const VIEW = {
  get w() { return canvas.clientWidth; },
  get h() { return canvas.clientHeight; }
};

const car = {
  x: 400,
  y: 300,
  angle: 0,
  speed: 0,
  maxSpeed: 5,
  accel: 0.15,
  friction: 0.98,
  width: 40,
  height: 70,
  color: '#f00'
};

let obstacles = [];
let myId = null;
let players = {};

function generateObstacles() {
  obstacles = [];
  for (let i = 0; i < 30; i++) {
    obstacles.push({
      x: Math.random() * (WORLD.width - 60) + 30,
      y: Math.random() * (WORLD.height - 60) + 30,
      r: 30 + Math.random() * 20,
    });
  }
}
// 假設你的本地玩家物件叫 car，擁有 car.x, car.y
function updateCamera() {
  // 讓玩家大致置中
  camera.x = Math.max(0, Math.min(car.x - canvas.clientWidth / 2, WORLD.width - canvas.clientWidth));
  camera.y = Math.max(0, Math.min(car.y - canvas.clientHeight / 2, WORLD.height - canvas.clientHeight));
}

// ★ 將世界座標轉成螢幕座標
function worldToScreen(wx, wy) {
  return { x: wx - camera.x, y: wy - camera.y };
}

// ★ 畫網格（每 100px 一條）
function drawGrid(step = 100) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;

  // 計算目前畫面可見範圍覆蓋的世界座標
  const viewLeft = camera.x;
  const viewTop = camera.y;
  const viewRight = camera.x + VIEW.w;
  const viewBottom = camera.y + VIEW.h;

  // 從對齊網格的整數倍開始畫
  const startX = Math.floor(viewLeft / step) * step;
  const startY = Math.floor(viewTop / step) * step;

  for (let x = startX; x <= viewRight; x += step) {
    const s = worldToScreen(x, 0);
    ctx.beginPath();
    ctx.moveTo(s.x, 0);
    ctx.lineTo(s.x, VIEW.h;
    ctx.stroke();
  }

  for (let y = startY; y <= viewBottom; y += step) {
    const s = worldToScreen(0, y);
    ctx.beginPath();
    ctx.moveTo(0, s.y);
    ctx.lineTO(VIEW.w, s.y);
    ctx.stroke();
  }
  ctx.restore();
}

// ★ 畫世界邊界（四周一個大矩形）
function drawWorldBorder() {
  ctx.save();
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 3;

  const tl = worldToScreen(0, 0);
  const br = worldToScreen(WORLD.width, WORLD.height);
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.restore();
}


function drawCar(x, y, angle, color) {
  const s = worldToScreen(wx, wy);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fillRect(-car.width/2, -car.height/2, car.width, car.height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(-car.width/4, -car.height/2+10, car.width/2, car.height/2);
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

function getCamera() {
  const cam = {
    x: Math.max(0, Math.min(map.width - canvas.width, car.x - canvas.width / 2)),
    y: Math.max(0, Math.min(map.height - canvas.height, car.y - canvas.height / 2)),
  };
  return cam;
}

// 搖桿
const joystick = document.getElementById('joystick');
const stick = document.getElementById('stick');
const joy = { dx: 0, dy: 0, active: false };
let joyRect = joystick.getBoundingClientRect();

function updateJoystick(e) {
  let x, y;
  if (e.touches) {
    x = e.touches[0].clientX - joyRect.left - 55;
    y = e.touches[0].clientY - joyRect.top - 55;
  } else {
    x = e.clientX - joyRect.left - 55;
    y = e.clientY - joyRect.top - 55;
  }
  let len = Math.sqrt(x*x + y*y);
  if (len > 45) {
    x *= 45/len;
    y *= 45/len;
  }
  stick.style.left = `${x+35}px`;
  stick.style.top = `${y+35}px`;
  joy.dx = x/45;
  joy.dy = y/45;
  joy.active = true;
}
function resetJoystick() {
  stick.style.left = "35px";
  stick.style.top = "35px";
  joy.dx = 0;
  joy.dy = 0;
  joy.active = false;
}

joystick.addEventListener('touchstart', updateJoystick);
joystick.addEventListener('touchmove', updateJoystick);
joystick.addEventListener('touchend', resetJoystick);
joystick.addEventListener('mousedown', (e)=>{joyRect=joystick.getBoundingClientRect();updateJoystick(e);});
joystick.addEventListener('mousemove', (e)=>{if(joy.active){updateJoystick(e);}});
joystick.addEventListener('mouseup', resetJoystick);
joystick.addEventListener('mouseleave', resetJoystick);
document.body.addEventListener('mouseup', resetJoystick);

function loop() {
  // 控制 & 物理
  if (joy.active) {
    const len = Math.hypot(joy.dx, joy.dy);
    if (len > 0.5) {
      car.angle = Math.atan2(joy.dy, joy.dx);
      car.speed = Math.min(car.speed + car.accel, car.maxSpeed);
    }
  }
  car.speed *= car.friction;
  car.x += Math.cos(car.angle) * car.speed;
  car.y += Math.sin(car.angle) * car.speed;

  // 用 WORLD 做邊界夾住
  car.x = Math.max(car.width/2,  Math.min(WORLD.width  - car.width/2,  car.x));
  car.y = Math.max(car.height/2, Math.min(WORLD.height - car.height/2, car.y));

  updateCamera();

  // 只清一次（用 VIEW 尺寸）
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);

  // 背景：網格 + 世界邊界
  drawGrid(100);
  drawWorldBorder();

  // 障礙物（同時做碰撞）
  for (let obs of obstacles) {
    const dx = car.x - obs.x, dy = car.y - obs.y;
    if (Math.hypot(dx, dy) < obs.r + car.width/2) {
      car.speed = -car.maxSpeed/2;
    }
    drawObstacle(obs);
  }

  // 同步到後端
  if (ws.readyState === WebSocket.OPEN && myId) {
    ws.send(JSON.stringify({ type: 'move', x: car.x, y: car.y, angle: car.angle }));
  }

  // 畫所有玩家（世界座標 → 螢幕）
  for (const id in players) {
    const p = players[id];
    drawCar(p.x, p.y, p.angle, p.color);
    if (id === myId) {
      const s = worldToScreen(p.x, p.y);
      ctx.save();
      ctx.strokeStyle = 'yellow';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, car.width/2 + 8, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 可選：再畫一次本地車（若 players 不含自己）
  drawCar(car.x, car.y, car.angle, '#ff4757');

  requestAnimationFrame(loop);
}

function drawLocalCar() {
  const size = 40; // 車寬
  const length = 70; // 車長
  const screen = worldToScreen(car.x, car.y);

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(car.angle || 0);
  ctx.fillStyle = '#ff4757';
  ctx.fillRect(-size/2, -length/2, size, length);
  ctx.restore();
}


// --- WebSocket 連線 ---
const ws = new WebSocket(`ws://${location.host}`);
ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type === 'init') {
    myId = msg.id;
    players = msg.players;
    generateObstacles();
  }
  if (msg.type === 'sync') {
    players = msg.players;
  }
  if (msg.type === 'leave') {
    delete players[msg.id];
  }
};

generateObstacles();
loop();
