// server.js — 用 Express 供應靜態檔 + 用 ws 做 WebSocket 同步
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws"; // ← 加上 WebSocket

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// 讓 index.html / main.js / style.css 在同資料夾即可被存取
app.use(express.static(__dirname));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** ---- 遊戲世界狀態（權威在伺服器） ---- */
const WORLD = { width: 4000, height: 3000 };

// 固定障礙物，由伺服器開機時生成一次，所有玩家一致
const obstacles = [];
(function generateObstacles() {
  const count = 30;
  for (let i = 0; i < count; i++) {
    obstacles.push({
      x: Math.random() * (WORLD.width  - 60) + 30,
      y: Math.random() * (WORLD.height - 60) + 30,
      r: 30 + Math.random() * 20
    });
  }
})();

const players = new Map(); // id -> {x,y,angle,color}
let uidCounter = 1;

function randomColor() {
  const c = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `#${c}`;
}

function packPlayers() {
  const obj = {};
  for (const [id, p] of players) obj[id] = p;
  return obj;
}

function broadcast(msgObj) {
  const data = JSON.stringify(msgObj);
  wss.clients.forEach((client) => {
    // ← 修正：用 WebSocket.OPEN 常數
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

wss.on("connection", (ws) => {
  const id = String(uidCounter++);
  // 初始玩家狀態（可放出生點邏輯）
  const spawn = {
    x: 200 + Math.random() * (WORLD.width - 400),
    y: 150 + Math.random() * (WORLD.height - 300),
    angle: 0,
    color: randomColor()
  };
  players.set(id, spawn);

  // 傳給新玩家：自己的 id、目前所有玩家、障礙物、世界大小
  ws.send(JSON.stringify({
    type: "init",
    id,
    world: WORLD,
    players: packPlayers(),
    obstacles
  }));

  // 通知其他人有新玩家加入（前端可忽略自己）
  broadcast({ type: "join", id, player: players.get(id) });

  // 接收移動
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "move" && players.has(id)) {
        const p = players.get(id);
        // 最小授信：只存座標與角度（可加速度/防外掛邏輯）
        p.x = Number.isFinite(+msg.x) ? +msg.x : p.x;
        p.y = Number.isFinite(+msg.y) ? +msg.y : p.y;
        p.angle = Number.isFinite(+msg.angle) ? +msg.angle : p.angle;
      }
    } catch {
      // 忽略壞訊息
    }
  });

  ws.on("close", () => {
    players.delete(id);
    broadcast({ type: "leave", id });
  });
});

// 以固定頻率廣播全量玩家狀態（10Hz 足夠順）
setInterval(() => {
  if (wss.clients.size > 0) {
    broadcast({ type: "sync", players: packPlayers() });
  }
}, 100);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
