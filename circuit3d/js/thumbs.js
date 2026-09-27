// ─────────────────────────────────────────────────────────────
//  thumbs.js — sidebar pictures rendered from the real 3D models
//
//  Runs once after load on a small throwaway renderer, so the parts
//  library always shows exactly what lands on the board.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const PARTS = {
    resistor: () => App.buildResistor({ x: -0.8, z: 0 }, { x: 0.8, z: 0 }, 470).group,
    led:      () => { const g = App.buildLED({ x: -0.4, z: 0 }, { x: 0.4, z: 0 }, 'red').group; g.userData.setLit?.(true, 0.8); return g; },
    battery:  () => App.buildBattery(0, 0).group,
    buzzer:   () => App.buildBuzzer({ x: -0.4, z: 0 }, { x: 0.4, z: 0 }).group,
    button:   () => App.buildButton({ x: -0.6, z: 0 }, { x: 0.6, z: 0 }).group,
    wire:     () => {
      const g = new THREE.Group();
      g.add(App.buildWire(new THREE.Vector3(-0.9, 0, 0.25), new THREE.Vector3(0.9, 0, -0.25), 0xef4444));
      return g;
    },
  };

  function render() {
    const slots = document.querySelectorAll('[data-thumb]');
    if (!slots.length || !window.THREE) return;
    const SIZE = 144;
    let r;
    try {
      r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch { return; }
    r.setSize(SIZE, SIZE, false);
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    if (THREE.RoomEnvironment) {
      const pm = new THREE.PMREMGenerator(r);
      scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(-3, 6, 4);
    scene.add(key);

    const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 100);

    slots.forEach(slot => {
      const make = PARTS[slot.dataset.thumb];
      if (!make) return;
      const g = make();
      scene.add(g);
      // frame the part: fit its bounds, seen from the front and a little above
      const box = new THREE.Box3().setFromObject(g);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      const dist = size / (2 * Math.tan((cam.fov * Math.PI) / 360)) * 0.92;
      cam.position.set(c.x + dist * 0.45, c.y + dist * 0.55, c.z + dist * 0.72);
      cam.lookAt(c);
      r.render(scene, cam);
      const img = new Image();
      img.alt = '';
      img.src = r.domElement.toDataURL('image/png');
      slot.textContent = '';
      slot.appendChild(img);
      scene.remove(g);
      App.disposeGroup(g);
    });

    r.dispose();
    r.forceContextLoss?.();
  }

  // After first paint, so the editor itself is never waiting on this.
  window.addEventListener('load', () => setTimeout(render, 150));

})(window.App = window.App || {});
