import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// ✅ 用絕對路徑提供靜態檔
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// ✅ 首頁兜底（含 SPA 其他路由也回 index.html）
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const TICK_RATE = 60;
const SNAPSHOT_RATE = 20;
const TRACK = { width: 1365, height: 768 };

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

class Car {
  constructor(id, name){
    this.id = id;
    this.name = name || `Player-${id.slice(0,4)}`;
    this.x = Math.random()*300 + 200;
    this.y = Math.random()*200 + 500;
    this.angle = -Math.PI/2;
    this.speed = 0;
    this.inputs = { up:false, down:false, left:false, right:false, boost:false, offRoad:false };
    this.color = '#'+Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0');
    this.lap = 0;
    this.lastCheckpoint = 0;
    this.finished = false;
    this.spawnTime = Date.now();
  }
}
const players = new Map();

io.on('connection', (socket)=>{
  socket.on('join', (name)=>{
    players.set(socket.id, new Car(socket.id, name));
    socket.emit('joined', { id: socket.id, track: TRACK });
    io.emit('players', serializePlayers());
  });

  socket.on('inputs', (inp)=>{
    const p = players.get(socket.id);
    if(!p) return;
    p.inputs = { ...p.inputs, ...inp };
  });

  socket.on('rename', (name)=>{
    const p = players.get(socket.id);
    if(p){ p.name = (name||'').slice(0,16); io.emit('players', serializePlayers()); }
  });

  // ✅ 前端 ping 用的 ack
  socket.on('pingcheck', (ack)=> ack && ack());

  socket.on('disconnect', ()=>{
    players.delete(socket.id);
    io.emit('despawn', socket.id);
  });
});

function physicsStep(dt){
  for(const [,p] of players){
    if(p.finished) continue;
    const ACCEL = 900;
    const BRAKE = 1400;
    const MAX_SPEED = p.inputs.boost ? 700 : 520;
    const TURN_RATE = 2.8;
    const FRICTION = p.inputs.offRoad ? 2.5 : 1.4;

    let steer = 0;
    if(p.inputs.left) steer -= 1;
    if(p.inputs.right) steer += 1;
    p.angle += steer * TURN_RATE * dt * clamp(p.speed/MAX_SPEED, 0.2, 1.0);

    if(p.inputs.up)   p.speed += ACCEL * dt;
    if(p.inputs.down) p.speed -= BRAKE * dt;
    p.speed -= Math.sign(p.speed) * FRICTION * 60 * dt;
    p.speed = clamp(p.speed, -260, MAX_SPEED);

    p.x += Math.cos(p.angle) * p.speed * dt;
    p.y += Math.sin(p.angle) * p.speed * dt;

    p.x = clamp(p.x, 0, TRACK.width);
    p.y = clamp(p.y, 0, TRACK.height);
  }
}

function serializePlayers(){
  const arr = [];
  for(const [,p] of players){
    arr.push({ id:p.id, name:p.name, x:p.x, y:p.y, angle:p.angle, speed:p.speed, color:p.color, lap:p.lap, finished:p.finished });
  }
  return arr;
}

let accumulator = 0;
let last = Date.now();
let snapshotTimer = 0;

setInterval(()=>{
  const now = Date.now();
  const dt = (now - last)/1000;
  last = now;

  accumulator += dt;
  const step = 1/TICK_RATE;
  while(accumulator >= step){
    physicsStep(step);
    accumulator -= step;
  }

  snapshotTimer += dt;
  if(snapshotTimer >= 1/SNAPSHOT_RATE){
    io.emit('state', serializePlayers());
    snapshotTimer = 0;
  }
}, 1000/120);

server.listen(PORT, ()=>{
  console.log('🚗 Racer server listening on http://localhost:'+PORT);
});
