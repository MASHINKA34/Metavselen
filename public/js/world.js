// world.js — 3D scene + collision data

var COLLISION_CIRCLES = []; // { x, z, r }
var COLLISION_RECTS   = []; // { x, z, hw, hd }  (half-width, half-depth)

var _TREE_SPOTS = [
  [-22,-22],[22,-22],[-22,22],[22,22],
  [-35,0],[35,0],[0,-35],[0,35],
  [-28,12],[28,-12],[12,28],[-12,-28],
  [-40,20],[40,-20],[20,40],[-20,-40],
  [-15,-35],[15,35],[35,15],[-35,-15],
  [50,50],[-50,50],[50,-50],[-50,-50],
  [45,10],[-45,10],[10,45],[-10,-45],
];

// Bench positions (world space)
var _BENCH_SPOTS = [[8,3],[-8,3],[8,-3],[-8,-3]];

// Rock positions
var _ROCK_SPOTS = [[-12,-8],[14,9],[-7,20],[25,-5],[-20,5],[8,-18]];

function buildWorld(scene) {
  COLLISION_CIRCLES = [];
  COLLISION_RECTS   = [];

  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.FogExp2(0x87CEEB, 0.008);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -80;
  sun.shadow.camera.right = sun.shadow.camera.top = 80;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshLambertMaterial({ color: 0x5a8a45 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(300, 60, 0x000000, 0x000000);
  grid.material.opacity = 0.07;
  grid.material.transparent = true;
  scene.add(grid);

  addPath(scene);
  addPavilion(scene);
  addFountain(scene, -18, -18);
  COLLISION_CIRCLES.push({ x: -18, z: -18, r: 3.6 });

  // Benches + their rect colliders
  _BENCH_SPOTS.forEach(([x, z]) => {
    addBench(scene, x, z);
    COLLISION_RECTS.push({ x, z, hw: 1.15, hd: 0.35 });
  });

  // Trees + circle colliders
  _TREE_SPOTS.forEach(([x, z]) => {
    addTree(scene, x, z);
    COLLISION_CIRCLES.push({ x, z, r: 0.55 });
  });

  // Pavilion pillar colliders
  [[-5,-5],[5,-5],[-5,5],[5,5]].forEach(([x, z]) => {
    COLLISION_CIRCLES.push({ x, z, r: 0.42 });
  });

  // Pavilion platform WALL edges (with gaps where paths enter: ±1.5 on each axis)
  // North (z=+6): two segments with centre gap for path
  COLLISION_RECTS.push({ x: -3.75, z:  6,  hw: 2.25, hd: 0.3 });
  COLLISION_RECTS.push({ x:  3.75, z:  6,  hw: 2.25, hd: 0.3 });
  // South (z=-6)
  COLLISION_RECTS.push({ x: -3.75, z: -6,  hw: 2.25, hd: 0.3 });
  COLLISION_RECTS.push({ x:  3.75, z: -6,  hw: 2.25, hd: 0.3 });
  // East (x=+6)
  COLLISION_RECTS.push({ x:  6, z: -3.75,  hw: 0.3, hd: 2.25 });
  COLLISION_RECTS.push({ x:  6, z:  3.75,  hw: 0.3, hd: 2.25 });
  // West (x=-6)
  COLLISION_RECTS.push({ x: -6, z: -3.75,  hw: 0.3, hd: 2.25 });
  COLLISION_RECTS.push({ x: -6, z:  3.75,  hw: 0.3, hd: 2.25 });

  // Rocks + circle colliders
  _ROCK_SPOTS.forEach(([x, z]) => {
    addRock(scene, x, z);
    COLLISION_CIRCLES.push({ x, z, r: 0.5 });
  });
}

function addPath(scene) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xd4a96a });
  const h = new THREE.Mesh(new THREE.PlaneGeometry(60, 3), mat);
  h.rotation.x = -Math.PI / 2; h.position.y = 0.01;
  scene.add(h);
  const v = new THREE.Mesh(new THREE.PlaneGeometry(3, 60), mat);
  v.rotation.x = -Math.PI / 2; v.position.y = 0.01;
  scene.add(v);
}

function addPavilion(scene) {
  const platMat   = new THREE.MeshLambertMaterial({ color: 0xe8d5b7 });
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0xf5efe0 });
  const roofMat   = new THREE.MeshLambertMaterial({ color: 0xb34040 });

  const platform = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 12), platMat);
  platform.position.set(0, 0.15, 0); platform.receiveShadow = true;
  scene.add(platform);

  [[-5,-5],[5,-5],[-5,5],[5,5]].forEach(([px, pz]) => {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 5, 10), pillarMat);
    pillar.position.set(px, 2.8, pz); pillar.castShadow = true;
    scene.add(pillar);
  });

  const beam = new THREE.Mesh(new THREE.BoxGeometry(13, 0.4, 13), platMat);
  beam.position.set(0, 5.35, 0);
  scene.add(beam);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(8.5, 2.5, 4), roofMat);
  roof.position.set(0, 6.55, 0); roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  scene.add(roof);

  const tile = new THREE.Mesh(new THREE.PlaneGeometry(11, 11),
    new THREE.MeshLambertMaterial({ color: 0xdcc89a }));
  tile.rotation.x = -Math.PI / 2; tile.position.set(0, 0.31, 0);
  scene.add(tile);
}

function addFountain(scene, x, z) {
  const stone = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const water = new THREE.MeshLambertMaterial({ color: 0x3399ff, transparent: true, opacity: 0.75 });

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.6, 20), stone);
  basin.position.set(x, 0.3, z); basin.receiveShadow = true; scene.add(basin);

  const surf = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.15, 20), water);
  surf.position.set(x, 0.52, z); scene.add(surf);

  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 2.2, 10), stone);
  col.position.set(x, 1.4, z); col.castShadow = true; scene.add(col);

  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 0.3, 12), stone);
  bowl.position.set(x, 2.65, z); scene.add(bowl);
}

function addBench(scene, x, z) {
  const wood  = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
  const metal = new THREE.MeshLambertMaterial({ color: 0x555555 });

  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), wood);
  seat.position.set(x, 0.55, z); seat.castShadow = true; scene.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.1), wood);
  back.position.set(x, 0.92, z - 0.25); back.castShadow = true; scene.add(back);

  [[-0.9],[0.9]].forEach(([lx]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.5), metal);
    leg.position.set(x + lx, 0.27, z); scene.add(leg);
  });
}

function addTree(scene, x, z) {
  const h = 3.5 + Math.random() * 3;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.28, h * 0.45, 8),
    new THREE.MeshLambertMaterial({ color: 0x6B4226 })
  );
  trunk.position.set(x, h * 0.225, z); trunk.castShadow = true; scene.add(trunk);

  [0x2d6a2d, 0x1f8a1f, 0x3a7a3a].forEach((col, i) => {
    const layer = new THREE.Mesh(
      new THREE.ConeGeometry(1.8 - i * 0.3, h * 0.38, 8),
      new THREE.MeshLambertMaterial({ color: col })
    );
    layer.position.set(x, h * 0.45 + i * h * 0.18, z); layer.castShadow = true; scene.add(layer);
  });
}

function addRock(scene, x, z) {
  const s = 0.3 + Math.random() * 0.5;
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(s, 0),
    new THREE.MeshLambertMaterial({ color: 0x999999 })
  );
  rock.position.set(x, s * 0.5, z);
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  rock.castShadow = true;
  scene.add(rock);
}
