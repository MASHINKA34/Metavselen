// main.js — bootstraps the engine, game loop, and UI bindings

(function () {
  // ─── Three.js renderer ───────────────────────────────────────────────────
  const canvas   = document.getElementById('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (renderer.outputColorSpace !== undefined) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 800);

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ─── Build world & player ─────────────────────────────────────────────────
  buildWorld(scene);
  createLocalPlayer(scene, camera);

  // ─── Network (socket connects immediately; join on login) ─────────────────
  Network.init(scene);

  // ─── Game loop ────────────────────────────────────────────────────────────
  let prevTime = 0;
  function loop(time) {
    requestAnimationFrame(loop);
    const dt = Math.min((time - prevTime) / 1000, 0.05);
    prevTime = time;

    if (Network.joined) {
      updateLocalPlayer(dt);
      updateOtherPlayers(dt);
      ChatBubbles.tick(dt);
      Network.sendMove(localPlayer.position, localPlayer.rotY);
      Voice.updatePositions(localPlayer.position, getOthersPositions());
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);

  // ─── Login ────────────────────────────────────────────────────────────────
  function doLogin() {
    const name  = document.getElementById('player-name').value.trim() || 'Игрок';
    const color = document.getElementById('player-color').value;

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-ui').style.display = 'block';

    Network.join(name, color);

    // Request pointer lock on first click after entering
    canvas.requestPointerLock?.();
  }

  document.getElementById('enter-btn').addEventListener('click', doLogin);
  document.getElementById('player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  // ─── Chat ─────────────────────────────────────────────────────────────────
  function sendChat() {
    const input = document.getElementById('chat-input');
    const msg   = input.value.trim();
    if (!msg) { input.blur(); return; }
    Network.sendChat(msg);
    input.value = '';
    input.blur();
  }

  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  // Prevent WASD from moving player while typing in chat
  document.getElementById('chat-input').addEventListener('focus', () => {
    keys['KeyW'] = keys['KeyA'] = keys['KeyS'] = keys['KeyD'] = false;
  });

})();
