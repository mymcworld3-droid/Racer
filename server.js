import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public")); // 把遊戲檔放在 public

// 儲存所有玩家狀態
let players = {};

io.on("connection", (socket) => {
  console.log("玩家連線:", socket.id);

  // 初始化玩家
  players[socket.id] = { x: 400, y: 300, angle: 0 };

  // 傳送目前玩家清單
  socket.emit("currentPlayers", players);

  // 廣播新玩家加入
  socket.broadcast.emit("newPlayer", { id: socket.id, ...players[socket.id] });

  // 玩家移動
  socket.on("playerMove", (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].angle = data.angle;
      socket.broadcast.emit("playerMoved", { id: socket.id, ...players[socket.id] });
    }
  });

  // 玩家斷線
  socket.on("disconnect", () => {
    console.log("玩家離開:", socket.id);
    delete players[socket.id];
    io.emit("playerDisconnected", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`伺服器運行在 http://localhost:${PORT}`));
