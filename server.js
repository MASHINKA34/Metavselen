const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const players = {};

function randomSpawn() {
  const angle = Math.random() * Math.PI * 2;
  const r = 3 + Math.random() * 8;
  return { x: Math.cos(angle) * r, y: 0, z: Math.sin(angle) * r, rotY: 0 };
}

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    const spawn = randomSpawn();
    players[socket.id] = {
      id: socket.id,
      name: String(data.name || 'Игрок').slice(0, 20),
      color: data.color || '#ff8844',
      ...spawn
    };

    // Send this player their own data + all others
    socket.emit('init', {
      self: players[socket.id],
      others: Object.values(players).filter(p => p.id !== socket.id)
    });

    // Notify others
    socket.broadcast.emit('player_joined', players[socket.id]);
    console.log(`[+] ${players[socket.id].name} (total: ${Object.keys(players).length})`);
  });

  socket.on('move', (data) => {
    if (!players[socket.id]) return;
    players[socket.id].x = data.x;
    players[socket.id].y = data.y;
    players[socket.id].z = data.z;
    players[socket.id].rotY = data.rotY;
    socket.broadcast.emit('player_moved', {
      id: socket.id,
      x: data.x, y: data.y, z: data.z, rotY: data.rotY
    });
  });

  socket.on('chat', (msg) => {
    if (!players[socket.id]) return;
    const p = players[socket.id];
    io.emit('chat', {
      id: socket.id,
      name: p.name,
      color: p.color,
      msg: String(msg).slice(0, 200)
    });
  });

  // WebRTC signaling relay
  socket.on('signal', ({ to, data }) => {
    socket.to(to).emit('signal', { from: socket.id, data });
  });

  // Voice ready notification
  socket.on('voice_ready', () => {
    socket.broadcast.emit('voice_ready', { from: socket.id });
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      console.log(`[-] ${players[socket.id].name} (total: ${Object.keys(players).length - 1})`);
      io.emit('player_left', socket.id);
      delete players[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌐 MetaVerse запущена: http://localhost:${PORT}\n`);
});
