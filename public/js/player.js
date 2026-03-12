// player.js — local player avatar, controls, physics, collision

var localPlayer = {
  position: new THREE.Vector3(0, 0, 5),
  rotY: 0,
  mesh: null,
  camera: null,
  speed: 7
};

var camYaw   = 0;
var camPitch = 0.25;
var keys     = {};
var joystick = { x: 0, y: 0 };
var pointerLocked = false;

// Physics
var _velY     = 0;
var _onGround = true;
var GRAVITY   = -22;
var JUMP_V    =  7.5;

// ─── Init ─────────────────────────────────────────────────────────────────────
function createLocalPlayer(scene, camera) {
  localPlayer.camera = camera;
  localPlayer.mesh   = makeAvatarMesh('#4488ff');
  localPlayer.mesh.position.copy(localPlayer.position);
  scene.add(localPlayer.mesh);

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyT' && document.activeElement !== document.getElementById('chat-input')) {
      e.preventDefault();
      document.getElementById('chat-input').focus();
    }
    if (e.code === 'Escape') document.getElementById('chat-input').blur();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  const canvas = document.getElementById('canvas');
  canvas.addEventListener('click', () => {
    if (window.Network && window.Network.joined) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = !!document.pointerLockElement;
  });
  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    camYaw   -= e.movementX * 0.0025;
    camPitch += e.movementY * 0.0025;
    camPitch = Math.max(-0.15, Math.min(0.7, camPitch));
  });

  setupJoystick();
  setupMobileCamDrag();
  return localPlayer;
}

// ─── Avatar mesh (faces -Z by default) ────────────────────────────────────────
function makeAvatarMesh(bodyColor) {
  const g     = new THREE.Group();
  const skin  = new THREE.MeshLambertMaterial({ color: 0xffe0b2 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x1a3a8a });
  const shoe  = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const hair  = new THREE.MeshLambertMaterial({ color: 0x2e1503 });
  const shirt = new THREE.MeshLambertMaterial({ color: bodyColor });
  const eye   = new THREE.MeshLambertMaterial({ color: 0x111133 });

  // Hips
  g.add(obj(new THREE.BoxGeometry(0.46, 0.2, 0.26), pants, [0, 0.52, 0]));
  // Torso
  g.add(obj(new THREE.BoxGeometry(0.52, 0.58, 0.28), shirt, [0, 0.88, 0], true));
  // Head
  g.add(obj(new THREE.SphereGeometry(0.27, 14, 14), skin, [0, 1.46, 0], true));
  // Hair
  g.add(obj(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI*2, 0, Math.PI/2), hair, [0, 1.53, 0]));
  // Eyes — at z=-0.23 (facing -Z = forward)
  [-0.09, 0.09].forEach(ex => g.add(obj(new THREE.SphereGeometry(0.05, 6, 6), eye, [ex, 1.49, -0.23])));
  // Nose
  g.add(obj(new THREE.SphereGeometry(0.03, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0xd4956a }), [0, 1.43, -0.26]));

  // Arms (pivot at shoulder)
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.34, 1.12, 0);
    pivot.add(obj(new THREE.CylinderGeometry(0.075, 0.068, 0.38, 8), skin, [0, -0.20, 0], true));
    pivot.add(obj(new THREE.CylinderGeometry(0.065, 0.06,  0.34, 8), skin, [0, -0.52, 0]));
    pivot.add(obj(new THREE.SphereGeometry(0.075, 8, 8),             skin, [0, -0.72, 0]));
    g.add(pivot); return pivot;
  }

  // Legs (pivot at hip)
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.155, 0.44, 0);
    pivot.add(obj(new THREE.CylinderGeometry(0.1,   0.09,  0.42, 8), pants, [0, -0.23, 0], true));
    pivot.add(obj(new THREE.CylinderGeometry(0.085, 0.078, 0.38, 8),
      new THREE.MeshLambertMaterial({ color: 0x0f2a6e }), [0, -0.62, 0]));
    pivot.add(obj(new THREE.BoxGeometry(0.17, 0.1, 0.28), shoe, [0, -0.84, -0.03]));
    g.add(pivot); return pivot;
  }

  const la = makeArm(-1), ra = makeArm(1);
  const ll = makeLeg(-1), rl = makeLeg(1);
  g.userData = { leftArm: la, rightArm: ra, leftLeg: ll, rightLeg: rl, walkTime: 0, walkSpeed: 0 };
  return g;
}

// Helper: create Mesh at position
function obj(geo, mat, pos, shadow) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (shadow) m.castShadow = true;
  return m;
}

// ─── Name label sprite ────────────────────────────────────────────────────────
function makeNameLabel(name, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 56;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, 256, 56);
  ctx.font = 'bold 26px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color || '#ffffff';
  ctx.fillText(name.slice(0, 16), 128, 28);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false
  });
  const s = new THREE.Sprite(mat); s.scale.set(2.0, 0.44, 1);
  return s;
}

// ─── Collision ────────────────────────────────────────────────────────────────
function resolveCollisions(pos) {
  const R = 0.45;

  // Circle obstacles (trees, pillars, fountain, rocks)
  if (typeof COLLISION_CIRCLES !== 'undefined') {
    COLLISION_CIRCLES.forEach(ob => {
      const dx = pos.x - ob.x, dz = pos.z - ob.z;
      const distSq = dx*dx + dz*dz;
      const min = ob.r + R;
      if (distSq < min*min && distSq > 0.0001) {
        const d = Math.sqrt(distSq);
        pos.x = ob.x + (dx/d) * min;
        pos.z = ob.z + (dz/d) * min;
      }
    });
  }

  // Rectangle obstacles (benches)
  if (typeof COLLISION_RECTS !== 'undefined') {
    COLLISION_RECTS.forEach(rect => {
      const nearX = Math.max(rect.x - rect.hw, Math.min(rect.x + rect.hw, pos.x));
      const nearZ = Math.max(rect.z - rect.hd, Math.min(rect.z + rect.hd, pos.z));
      const dx = pos.x - nearX, dz = pos.z - nearZ;
      const distSq = dx*dx + dz*dz;
      if (distSq < R*R) {
        if (distSq > 0.0001) {
          const d = Math.sqrt(distSq);
          pos.x = nearX + (dx/d) * R;
          pos.z = nearZ + (dz/d) * R;
        } else {
          // Player center inside rect — push out nearest edge
          const dL = pos.x - (rect.x - rect.hw);
          const dR = (rect.x + rect.hw) - pos.x;
          const dF = pos.z - (rect.z - rect.hd);
          const dB = (rect.z + rect.hd) - pos.z;
          const m  = Math.min(dL, dR, dF, dB);
          if (m === dL)      pos.x = rect.x - rect.hw - R;
          else if (m === dR) pos.x = rect.x + rect.hw + R;
          else if (m === dF) pos.z = rect.z - rect.hd - R;
          else               pos.z = rect.z + rect.hd + R;
        }
      }
    });
  }
}

// ─── Update each frame ────────────────────────────────────────────────────────
function updateLocalPlayer(dt) {
  if (!localPlayer.mesh) return;

  const fwd   = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  const right = new THREE.Vector3( Math.cos(camYaw), 0, -Math.sin(camYaw));
  const spd   = localPlayer.speed * dt;
  let moved   = false;

  if (keys['KeyW'] || keys['ArrowUp'])    { localPlayer.position.addScaledVector(fwd,   spd);  moved = true; }
  if (keys['KeyS'] || keys['ArrowDown'])  { localPlayer.position.addScaledVector(fwd,  -spd);  moved = true; }
  if (keys['KeyA'] || keys['ArrowLeft'])  { localPlayer.position.addScaledVector(right, -spd); moved = true; }
  if (keys['KeyD'] || keys['ArrowRight']) { localPlayer.position.addScaledVector(right,  spd); moved = true; }

  if (Math.abs(joystick.x) > 0.08 || Math.abs(joystick.y) > 0.08) {
    localPlayer.position.addScaledVector(right, joystick.x * spd);
    localPlayer.position.addScaledVector(fwd,  -joystick.y * spd);
    moved = true;
  }

  // Jump (Space or mobile button)
  if ((keys['Space'] || keys['_jump']) && _onGround) {
    _velY = JUMP_V;
    _onGround = false;
  }

  // Gravity
  _velY += GRAVITY * dt;
  localPlayer.position.y += _velY * dt;

  // Ground
  if (localPlayer.position.y <= 0) {
    localPlayer.position.y = 0;
    _velY = 0;
    _onGround = true;
  }

  // World bounds
  const B = 90;
  localPlayer.position.x = Math.max(-B, Math.min(B, localPlayer.position.x));
  localPlayer.position.z = Math.max(-B, Math.min(B, localPlayer.position.z));

  // Collision (only on ground XZ)
  resolveCollisions(localPlayer.position);

  if (moved) localPlayer.rotY = camYaw;

  // Apply to mesh
  localPlayer.mesh.position.copy(localPlayer.position);
  localPlayer.mesh.rotation.y = localPlayer.rotY;

  // Walk animation
  const ud = localPlayer.mesh.userData;
  if (moved && _onGround) {
    ud.walkTime  += dt * 9;
    ud.walkSpeed  = Math.min(1, ud.walkSpeed + dt * 10);
  } else {
    ud.walkSpeed = Math.max(0, ud.walkSpeed - dt * 7);
  }
  // Jump pose: lean slightly
  if (!_onGround) {
    ud.leftLeg.rotation.x  = -0.4;
    ud.rightLeg.rotation.x =  0.4;
    ud.leftArm.rotation.x  =  0.5;
    ud.rightArm.rotation.x =  0.5;
  } else {
    const sw = Math.sin(ud.walkTime) * 0.55 * ud.walkSpeed;
    ud.leftLeg.rotation.x  =  sw;
    ud.rightLeg.rotation.x = -sw;
    ud.leftArm.rotation.x  = -sw * 0.5;
    ud.rightArm.rotation.x =  sw * 0.5;
  }

  // Camera
  const camDist = 5.5;
  localPlayer.camera.position.set(
    localPlayer.position.x + Math.sin(camYaw) * camDist * Math.cos(camPitch),
    localPlayer.position.y + 2.8 + Math.sin(camPitch) * camDist,
    localPlayer.position.z + Math.cos(camYaw) * camDist * Math.cos(camPitch)
  );
  localPlayer.camera.lookAt(
    localPlayer.position.x,
    localPlayer.position.y + 1.2,
    localPlayer.position.z
  );
}

// ─── Mobile joystick ──────────────────────────────────────────────────────────
function setupJoystick() {
  const outer = document.createElement('div');
  outer.id = 'joystick-outer';
  const inner = document.createElement('div');
  inner.id = 'joystick-inner';
  outer.appendChild(inner);
  document.body.appendChild(outer);

  // Jump button (mobile)
  const jumpBtn = document.createElement('button');
  jumpBtn.id = 'mobile-jump';
  jumpBtn.textContent = '↑';
  jumpBtn.style.cssText = `
    position:fixed; bottom:220px; left:75px;
    width:50px; height:50px; border-radius:50%;
    border:2px solid rgba(255,255,255,0.3);
    background:rgba(0,0,0,0.5); color:#fff;
    font-size:1.4rem; z-index:20; display:none;
    pointer-events:all; cursor:pointer;
  `;
  document.body.appendChild(jumpBtn);

  // Show on touch devices
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    jumpBtn.style.display = 'block';
  }

  jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); keys['_jump'] = true; }, { passive: false });
  jumpBtn.addEventListener('touchend',   (e) => { e.preventDefault(); keys['_jump'] = false; }, { passive: false });

  let touchId = null, baseX = 0, baseY = 0;
  const maxDist = 38;

  outer.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    touchId = t.identifier; baseX = t.clientX; baseY = t.clientY;
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== touchId) continue;
      const dx = t.clientX - baseX, dz = t.clientY - baseY;
      const dist = Math.sqrt(dx*dx + dz*dz);
      const clamped = Math.min(dist, maxDist);
      const angle = Math.atan2(dz, dx);
      joystick.x = Math.cos(angle) * (clamped / maxDist);
      joystick.y = Math.sin(angle) * (clamped / maxDist);
      inner.style.transform = `translate(calc(-50% + ${joystick.x*maxDist}px), calc(-50% + ${joystick.y*maxDist}px))`;
    }
  }, { passive: false });

  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        touchId = null; joystick.x = 0; joystick.y = 0;
        inner.style.transform = 'translate(-50%, -50%)';
      }
    }
  });
}

function setupMobileCamDrag() {
  let camTouchId = null, lastX = 0, lastY = 0;

  window.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX > window.innerWidth * 0.4 && camTouchId === null) {
        const jo = document.getElementById('joystick-outer');
        if (jo) {
          const r = jo.getBoundingClientRect();
          if (t.clientX >= r.left && t.clientX <= r.right &&
              t.clientY >= r.top  && t.clientY <= r.bottom) continue;
        }
        camTouchId = t.identifier; lastX = t.clientX; lastY = t.clientY;
      }
    }
  });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== camTouchId) continue;
      camYaw   -= (t.clientX - lastX) * 0.004;
      camPitch += (t.clientY - lastY) * 0.004;
      camPitch = Math.max(-0.15, Math.min(0.7, camPitch));
      lastX = t.clientX; lastY = t.clientY;
    }
  });
  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === camTouchId) camTouchId = null;
    }
  });
}
