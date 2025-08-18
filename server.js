const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const players = {};

app.use(express.static('public'));

wss.on('connection', function connection(ws) {
  let id = Math.random().toString(36).substr(2, 9);
  players[id] = {
    x: 400 + Math.random()*100,
    y: 300 + Math.random()*100,
    angle: 0,
    color: '#' + Math.floor(Math.random()*0xffffff).toString(16).padStart(6, '0')
  };

  ws.send(JSON.stringify({ type: 'init', id, players }));

  ws.on('message', function incoming(message) {
    try {
      const data = JSON.parse(message);
      if (data.type === 'move') {
        players[id].x = data.x;
        players[id].y = data.y;
        players[id].angle = data.angle;
      }
    } catch (e) {}
  });

  ws.on('close', function() {
    delete players[id];
    broadcast({ type: 'leave', id });
  });

  function broadcast(obj) {
    const msg = JSON.stringify(obj);
    wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }

  setInterval(() => {
    ws.send(JSON.stringify({ type: 'sync', players }));
  }, 50);
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});