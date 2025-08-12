// 1) 取得 io：保險用法（不論是否 module）
const socket = (window.io) ? window.io() : io();

// 2) Canvas 與 DOM 取得
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const nameInput = document.getElementById('name');
const joinBtn = document.getElementById('join');
const pingEl = document.getElementById('ping');

let myId = null;
let track = { width: 1365, height: 768 };
let players = new Map();
let carImg = new Image();
let trackImg = new Image();
carImg.src = 'assets/car.png';
trackImg.src = 'assets/track.png';

// Offscreen canvas to detect off-road via pixel color
const detectCanvas = document.createElement('canvas');
const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true });

// 3) 圖片載入完成後再啟動畫面更新
let trackReady = false;
trackImg.onload = () => {
  detectCanvas.width = trackImg.width;
  detectCanvas.height = trackImg.height;
  detectCtx.drawImage(trackImg, 0, 0);
  trackReady = true;
  requestAnimationFrame(draw);
};
trackImg.onerror = () => {
  console.error('Track image failed to load: assets/track.png');
};

function resize(){
  canvas.width = window.innerWidth;
  // 行動瀏覽器更穩的視窗高
  canvas.height = (window.visualViewport?.height || window.innerHeight);
}
resize();
window.addEventListener('resize', resize);

const camera = { x:0, y:0, scale: 1.0 };

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!trackReady) { requestAnimationFrame(draw); return; }

  // Camera follows me
  const me = players.get(myId);
  if(me){
    camera.x = me.x - canvas.width/2;
    camera.y = me.y - canvas.height/2;
  }

  // Draw track (simple camera translate)
  ctx.save();
  ctx.translate(-camera.x, -camera.y);
  ctx.drawImage(trackImg, 0, 0);

  for(const [,p] of players){
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    const scale = 0.16; // depends on source image size
    const w = carImg.width*scale, h = carImg.height*scale;
    ctx.filter = 'drop-shadow(0px 6px 6px rgba(0,0,0,0.6))';
    ctx.drawImage(carImg, -w/2, -h/2, w, h);

    // color overlay roof stripe
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = p.color;
    ctx.fillRect(-w/2, -h/2, w, h/8);
    ctx.globalCompositeOperation = 'source-over'; // ← 記得還原
    ctx.restore();

    // name
    ctx.save();
    ctx.translate(p.x, p.y - 40);
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 4;
    ctx.strokeText(p.name, 0, 0);
    ctx.fillText(p.name, 0, 0);
    ctx.restore();
  }

  ctx.restore();
  requestAnimationFrame(draw);
}

// Input
const keys = Object.create(null);
window.addEventListener('keydown', (e)=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Shift'].includes(e.key)) e.preventDefault();
  keys[e.key] = true;
  sendInputs();
});
window.addEventListener('keyup', (e)=>{
  keys[e.key] = false;
  sendInputs();
});

function isOffRoad(x,y){
  if(!trackReady) return false;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if(px<0 || py<0 || px>=detectCanvas.width || py>=detectCanvas.height) return true;
  const [r,g,b] = detectCtx.getImageData(px,py,1,1).data;
  return (g > r+10 && g > b+10);
}

let lastPing = performance.now();
function sendInputs(){
  const me = players.get(myId);
  let off = false;
  if(me) off = isOffRoad(me.x, me.y);
  const payload = {
    up: keys['ArrowUp'] || keys['w'] || keys['W'],
    down: keys['ArrowDown'] || keys['s'] || keys['S'],
    left: keys['ArrowLeft'] || keys['a'] || keys['A'],
    right: keys['ArrowRight'] || keys['d'] || keys['D'],
    boost: keys['Shift'] || keys[' '],
    offRoad: off
  };
  socket.emit('inputs', payload);
  const now = performance.now();
  if(now - lastPing > 800){
    const start = performance.now();
    socket.timeout(400).emit('pingcheck', ()=>{
      pingEl.textContent = Math.round(performance.now()-start)+'ms';
    });
    lastPing = now;
  }
}

// Network
joinBtn.addEventListener('click', ()=>{
  socket.emit('join', nameInput.value.trim() || '');
  nameInput.disabled = true;
  joinBtn.disabled = true;
});

socket.on('joined', (info)=>{
  myId = info.id;
  track = info.track;
});

socket.on('players', (arr)=>{
  players = new Map(arr.map(p=>[p.id,p]));
});

socket.on('state', (arr)=>{
  for(const p of arr){
    const existing = players.get(p.id);
    if(existing){
      Object.assign(existing, p);
    } else {
      players.set(p.id, p);
    }
  }
});

socket.on('despawn', (id)=>{
  players.delete(id);
});

// Mobile UI
const gasBtn = document.getElementById('gas');
const brakeBtn = document.getElementById('brake');
const boostBtn = document.getElementById('boost');

function bindHold(btn, on){
  let pressed = false;
  const set = (v)=>{ pressed=v; on(v); sendInputs(); };
  btn.addEventListener('touchstart', e=>{ e.preventDefault(); set(true); }, {passive:false});
  btn.addEventListener('touchend',   e=>{ e.preventDefault(); set(false); }, {passive:false});
  btn.addEventListener('mousedown', ()=>set(true));
  btn.addEventListener('mouseup',   ()=>set(false));
  document.addEventListener('mouseleave', ()=>pressed && set(false));
}
bindHold(gasBtn,  v=>{ keys['ArrowUp']=v; });
bindHold(brakeBtn,v=>{ keys['ArrowDown']=v; });
bindHold(boostBtn,v=>{ keys['Shift']=v; });

// Virtual stick for left/right
const stick = document.getElementById('stick');
let stickCenter = null;
stick.addEventListener('touchstart', (e)=>{
  const t = e.touches[0];
  stickCenter = { x:t.clientX, y:t.clientY };
}, {passive:false});
stick.addEventListener('touchmove', (e)=>{
  const t = e.touches[0];
  if(!stickCenter) return;
  const dx = t.clientX - stickCenter.x;
  keys['ArrowLeft'] = dx < -10;
  keys['ArrowRight']= dx > 10;
  sendInputs();
  e.preventDefault();
}, {passive:false});
stick.addEventListener('touchend', (e)=>{
  stickCenter = null;
  keys['ArrowLeft'] = keys['ArrowRight'] = false;
  sendInputs();
  e.preventDefault();
}, {passive:false});
