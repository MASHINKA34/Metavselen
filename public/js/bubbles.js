// bubbles.js — floating chat bubbles above avatars

var ChatBubbles = {
  _active: [], // array of updater functions

  show(scene, mesh, text, color) {
    // Canvas texture
    const cv  = document.createElement('canvas');
    cv.width  = 400;
    cv.height = 80;
    const ctx = cv.getContext('2d');

    // Pill background
    ctx.clearRect(0, 0, 400, 80);
    ctx.fillStyle = 'rgba(15,15,15,0.88)';
    ctx.beginPath();
    ctx.roundRect(4, 6, 392, 62, 18);
    ctx.fill();

    // Coloured left border accent
    ctx.fillStyle = color || '#f97316';
    ctx.beginPath();
    ctx.roundRect(4, 6, 5, 62, [18, 0, 0, 18]);
    ctx.fill();

    // Small triangle pointer at bottom center
    ctx.fillStyle = 'rgba(15,15,15,0.88)';
    ctx.beginPath();
    ctx.moveTo(192, 68); ctx.lineTo(200, 80); ctx.lineTo(208, 68);
    ctx.fill();

    // Message text (truncate to 32 chars)
    const maxLen = 32;
    const t = text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
    ctx.font = '600 22px Inter, Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, 204, 36);

    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3.2, 0.65, 1);
    scene.add(sprite);

    const SHOW     = 3.5; // seconds fully visible
    const FADE     = 0.9; // seconds to fade out
    const TOTAL    = SHOW + FADE;
    const Y_OFFSET = 3.0; // above mesh origin
    let elapsed    = 0;

    const upd = (dt) => {
      elapsed += dt;
      // Follow the mesh every frame
      sprite.position.set(
        mesh.position.x,
        mesh.position.y + Y_OFFSET,
        mesh.position.z
      );
      // Fade out phase
      if (elapsed > SHOW) {
        mat.opacity = Math.max(0, 1 - (elapsed - SHOW) / FADE);
      }
      if (elapsed >= TOTAL) {
        scene.remove(sprite);
        tex.dispose();
        mat.dispose();
        return false; // remove from active list
      }
      return true;
    };

    this._active.push(upd);
  },

  tick(dt) {
    this._active = this._active.filter(fn => fn(dt));
  }
};
