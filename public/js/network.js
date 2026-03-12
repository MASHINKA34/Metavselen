// network.js — Socket.io multiplayer

var Network = {
  socket: null,
  joined: false,
  myId: null,
  myName: '',
  myColor: '#4488ff',
  scene: null,
  others: {},
  _lastSent: 0,

  init(scene) {
    this.scene  = scene;
    this.socket = io();
    window.Network = this;
    this._bindEvents();
  },

  join(name, color) {
    this.myName  = name;
    this.myColor = color;
    // Recolor local avatar shirt (3rd child = torso BoxGeometry)
    if (localPlayer.mesh) {
      for (const child of localPlayer.mesh.children) {
        if (child.isMesh && child.geometry?.type === 'BoxGeometry' &&
            Math.abs(child.position.y - 0.88) < 0.05) {
          child.material = new THREE.MeshLambertMaterial({ color });
          break;
        }
      }
    }
    this.socket.emit('join', { name, color });
    this.joined = true;
  },

  sendMove(position, rotY) {
    const now = Date.now();
    if (now - this._lastSent < 50) return;
    this._lastSent = now;
    this.socket.emit('move', {
      x: +position.x.toFixed(3),
      y: +position.y.toFixed(3),
      z: +position.z.toFixed(3),
      rotY: +rotY.toFixed(3)
    });
  },

  sendChat(msg) { this.socket.emit('chat', msg); },

  _bindEvents() {
    const s = this.socket;

    s.on('init', ({ self, others }) => {
      this.myId = self.id;
      localPlayer.position.set(self.x, 0, self.z);
      localPlayer.rotY = self.rotY;
      if (localPlayer.mesh) localPlayer.mesh.position.copy(localPlayer.position);
      others.forEach(p => this._addOther(p));
      this._updateCount();
    });

    s.on('player_joined', (p) => {
      this._addOther(p);
      this._sysMsg(`${p.name} вошёл в мир`);
      this._updateCount();
    });

    s.on('player_moved', (data) => {
      const o = this.others[data.id];
      if (!o) return;
      o.prevPos.copy(o.targetPos);
      o.targetPos.set(data.x, data.y, data.z);
      o.targetRot = data.rotY;
    });

    s.on('player_left', (id) => {
      const o = this.others[id];
      if (!o) return;
      this._sysMsg(`${o.name} покинул мир`);
      this.scene.remove(o.mesh);
      this.scene.remove(o.label);
      delete this.others[id];
      this._updateCount();
      if (typeof Voice !== 'undefined') Voice.removePeer(id);
    });

    s.on('chat', ({ id, name, color, msg }) => {
      const nameHtml = `<span class="name" style="color:${color||'#fff'}">${_esc(name)}</span>`;
      this._chatMsg(`${nameHtml}: ${_esc(msg)}`);
    });

    // WebRTC signals
    s.on('signal', ({ from, data }) => {
      if (typeof Voice !== 'undefined') Voice.handleSignal(from, data);
    });

    // Voice ready: another player enabled their mic
    s.on('voice_ready', ({ from }) => {
      if (typeof Voice !== 'undefined') Voice.onPeerReady(from);
    });
  },

  _addOther(p) {
    if (this.others[p.id]) return;
    const mesh  = makeAvatarMesh(p.color || '#ff4444');
    mesh.position.set(p.x || 0, 0, p.z || 0);
    mesh.rotation.y = p.rotY || 0;
    this.scene.add(mesh);

    const label = makeNameLabel(p.name, p.color);
    label.position.set(p.x || 0, 2.1, p.z || 0);
    this.scene.add(label);

    const sp = new THREE.Vector3(p.x || 0, 0, p.z || 0);
    this.others[p.id] = {
      id: p.id, name: p.name, color: p.color,
      mesh, label,
      targetPos: sp.clone(),
      prevPos:   sp.clone(),
      targetRot: p.rotY || 0
    };
  },

  _sysMsg(text) {
    const div = document.getElementById('chat-messages');
    if (!div) return;
    const el = document.createElement('div');
    el.className = 'chat-msg chat-sys';
    el.textContent = '• ' + text;
    div.appendChild(el);
    div.scrollTop = div.scrollHeight;
  },

  _chatMsg(html) {
    const div = document.getElementById('chat-messages');
    if (!div) return;
    const el = document.createElement('div');
    el.className = 'chat-msg';
    el.innerHTML = html;
    div.appendChild(el);
    div.scrollTop = div.scrollHeight;
  },

  _updateCount() {
    const el = document.getElementById('players-count');
    if (el) el.textContent = `Игроков: ${Object.keys(this.others).length + 1}`;
  }
};

function updateOtherPlayers(dt) {
  const alpha = Math.min(1.0, dt * 14);
  Object.values(Network.others).forEach(o => {
    const isMoving = o.targetPos.distanceTo(o.prevPos) > 0.02;
    o.mesh.position.lerp(o.targetPos, alpha);
    o.mesh.rotation.y += (o.targetRot - o.mesh.rotation.y) * alpha;
    o.label.position.set(o.mesh.position.x, o.mesh.position.y + 2.1, o.mesh.position.z);

    // Walk animation
    const ud = o.mesh.userData;
    if (ud?.leftLeg) {
      if (isMoving) {
        ud.walkTime  += dt * 9;
        ud.walkSpeed  = Math.min(1, ud.walkSpeed + dt * 10);
      } else {
        ud.walkSpeed = Math.max(0, ud.walkSpeed - dt * 7);
      }
      const sw = Math.sin(ud.walkTime) * 0.55 * ud.walkSpeed;
      ud.leftLeg.rotation.x  =  sw;
      ud.rightLeg.rotation.x = -sw;
      ud.leftArm.rotation.x  = -sw * 0.5;
      ud.rightArm.rotation.x =  sw * 0.5;
    }
  });
}

function getOthersPositions() {
  return Object.values(Network.others).map(o => ({ id: o.id, pos: o.mesh.position }));
}

function _esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
