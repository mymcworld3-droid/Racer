
// ★ 世界尺寸（你可改大一點）
const WORLD = { width: 4000, height: 3000 };

// ★ 攝影機：把玩家放中央、計算可見範圍左上角
const camera = { x: 0, y: 0 };

// ★ 你的 canvas / ctx
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

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

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
const map = { width: 1600, height: 1200 };
let obstacles = [];
let myId = null;
let players = {};

function generateObstacles() {
  obstacles = [];
  for (let i = 0; i < 30; i++) {
    obstacles.push({
      x: Math.random() * (map.width - 60) + 30,
      y: Math.random() * (map.height - 60) + 30,
      r: 30 + Math.random() * 20,
    });
  }
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
  const viewRight = camera.x + canvas.clientWidth;
  const viewBottom = camera.y + canvas.clientHeight;

  // 從對齊網格的整數倍開始畫
  const startX = Math.floor(viewLeft / step) * step;
  const startY = Math.floor(viewTop / step) * step;

  for (let x = startX; x <= viewRight; x += step) {
    const s = worldToScreen(x, 0);
    ctx.beginPath();
    ctx.moveTo(s.x, 0);
    ctx.lineTo(s.x, canvas.clientHeight);
    ctx.stroke();
  }

  for (let y = startY; y <= viewBottom; y += step) {
    const s = worldToScreen(0, y);
    ctx.beginPath();
    ctx.moveTo(0, s.y);
    ctx.lineTo(canvas.clientWidth, s.y);
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
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fillRect(-car.width/2, -car.height/2, car.width, car.height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(-car.width/4, -car.height/2+10, car.width/2, car.height/2);
  ctx.restore();
}

function drawObstacle(obs, offsetX, offsetY) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(obs.x - offsetX, obs.y - offsetY, obs.r, 0, Math.PI*2);
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
// 假設你的本地玩家物件叫 car，擁有 car.x, car.y
function updateCamera() {
  // 讓玩家大致置中
  camera.x = Math.max(0, Math.min(car.x - canvas.clientWidth / 2, WORLD.width - canvas.clientWidth));
  camera.y = Math.max(0, Math.min(car.y - canvas.clientHeight / 2, WORLD.height - canvas.clientHeight));
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
  // 控制賽車
  if (joy.active) {
    let len = Math.sqrt(joy.dx*joy.dx + joy.dy*joy.dy);
    if (len > 0.5) {
      let direction = Math.atan2(joy.dy, joy.dx);
      car.angle = direction;
      car.speed += car.accel;
      car.speed = Math.min(car.speed, car.maxSpeed);
    }
  }
  car.speed *= car.friction;
  car.x += Math.cos(car.angle) * car.speed;
  car.y += Math.sin(car.angle) * car.speed;
  car.x = Math.max(car.width/2, Math.min(map.width-car.width/2, car.x));
  car.y = Math.max(car.height/2, Math.min(map.height-car.height/2, car.y));
  updateCamera();
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  // 碰撞障礙物
  for (let obs of obstacles) {
    let dx = car.x - obs.x;
    let dy = car.y - obs.y;
    if (Math.sqrt(dx*dx + dy*dy) < obs.r + car.width/2) {
      car.speed = -car.maxSpeed/2;
    }
  }
  drawGrid(100);
  drawWorldBorder();

  // 通知後端自己的座標
  if (ws.readyState === 1 && myId) {
    ws.send(JSON.stringify({
      type: 'move',
      x: car.x,
      y: car.y,
      angle: car.angle
    }));
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cam = getCamera();

  // 畫障礙物
  for (let obs of obstacles) {
    if (
      obs.x > cam.x - 50 && obs.x < cam.x + canvas.width + 50 &&
      obs.y > cam.y - 50 && obs.y < cam.y + canvas.height + 50
    ) {
      drawObstacle(obs, cam.x, cam.y);
    }
  }

  // 畫所有玩家車
  for (let id in players) {
    let p = players[id];
    drawCar(p.x - cam.x, p.y - cam.y, p.angle, p.color);
    // 自己車外框
    if (id === myId) {
      ctx.save();
      ctx.strokeStyle = 'yellow';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x - cam.x, p.y - cam.y, car.width/2+8, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  }
  drawLocalCar();

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
