
import io from '/socket.io/socket.io.js';

const socket = io();
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
trackImg.onload = ()=>{
  detectCanvas.width = trackImg.width;
  detectCanvas.height = trackImg.height;
  detectCtx.drawImage(trackImg, 0, 0);
};

function resize(){
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

const camera = { x:0, y:0, scale: 1.0 };

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!trackImg.complete) return;

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
    // tint
    ctx.filter = 'drop-shadow(0px 6px 6px rgba(0,0,0,0.6))';
    ctx.drawImage(carImg, -w/2, -h/2, w, h);
    // color overlay roof stripe
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = p.color;
    ctx.fillRect(-w/2, -h/2, w, h/8);
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
requestAnimationFrame(draw);

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
  if(!trackImg.complete) return false;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if(px<0 || py<0 || px>=detectCanvas.width || py>=detectCanvas.height) return true;
  const [r,g,b,a] = detectCtx.getImageData(px,py,1,1).data;
  // Road is gray-ish (#808080), grass is green-ish. If green component dominates, treat as off-road.
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
    socket.timeout(200).emit('pingcheck', ()=>{
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
  // update positions smoothly
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
function bindHold(btn, on, off){
  let down = false;
  const set = (v)=>{ down=v; on(v); sendInputs(); };
  btn.addEventListener('touchstart', e=>{ e.preventDefault(); set(true); });
  btn.addEventListener('touchend', e=>{ e.preventDefault(); set(false); });
  btn.addEventListener('mousedown', ()=>set(true));
  btn.addEventListener('mouseup', ()=>set(false));
  document.addEventListener('mouseleave', ()=>down && set(false));
}
bindHold(gasBtn,  v=>{ keys['ArrowUp']=v; }, ()=>{});
bindHold(brakeBtn,v=>{ keys['ArrowDown']=v; }, ()=>{});
bindHold(boostBtn,v=>{ keys['Shift']=v; }, ()=>{});

// Virtual stick for left/right
const stick = document.getElementById('stick');
let stickCenter = null;
stick.addEventListener('touchstart', (e)=>{
  const t = e.touches[0];
  stickCenter = { x:t.clientX, y:t.clientY };
});
stick.addEventListener('touchmove', (e)=>{
  const t = e.touches[0];
  if(!stickCenter) return;
  const dx = t.clientX - stickCenter.x;
  keys['ArrowLeft'] = dx < -10;
  keys['ArrowRight']= dx > 10;
  sendInputs();
});
stick.addEventListener('touchend', ()=>{
  stickCenter = null;
  keys['ArrowLeft'] = keys['ArrowRight'] = false;
  sendInputs();
});
