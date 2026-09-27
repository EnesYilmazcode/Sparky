// ─────────────────────────────────────────────────────────────
//  scene.js — Three.js scene, camera, renderer, lights
//
//  Physically based: filmic tone mapping, sRGB output, and a studio
//  environment map so metal leads and glossy epoxy actually reflect
//  something. The board sits on an anti-static bench mat.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const canvas    = document.getElementById('canvas');
  const container = document.getElementById('canvas-wrap');

  // ── Scene ──────────────────────────────────────────────────
  const BG = 0x23262b;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 55, 130);

  // ── Camera ─────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
  camera.position.set(0, 22, 30);
  camera.lookAt(0, 0, 0);

  // ── Renderer ───────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding      = THREE.sRGBEncoding;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;

  // Studio reflections. RoomEnvironment is a neutral lit box; prefiltered
  // once, it gives every standard material believable highlights.
  if (THREE.RoomEnvironment) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  // ── Orbit Controls ─────────────────────────────────────────
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping  = true;
  controls.dampingFactor  = 0.08;
  controls.minDistance    = 2;
  controls.maxDistance    = 90;
  controls.maxPolarAngle  = Math.PI * 0.495;   // stay above the bench
  controls.panSpeed       = 1.6;
  controls.zoomSpeed      = 1.1;
  controls.screenSpacePanning = true;
  controls.mouseButtons = {
    LEFT:   THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT:  THREE.MOUSE.PAN,
  };
  controls.target.set(0, 0, 0);

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ── Lighting ───────────────────────────────────────────────
  //  The environment map does most of the fill. The key light is the
  //  only shadow caster, and its shadow camera hugs the board so the
  //  contact shadows under parts stay sharp.
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3a3630, 0.12));

  const key = new THREE.DirectionalLight(0xfff4e5, 1.1);
  key.position.set(-10, 26, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { near: 5, far: 70, left: -17, right: 17, top: 12, bottom: -12 });
  key.shadow.bias       = -0.00025;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xcfe0ff, 0.3);
  rim.position.set(14, 10, -18);
  scene.add(rim);

  // ── Bench mat ──────────────────────────────────────────────
  //  A dark anti-static mat with a faint centimetre grid, fading into
  //  the background so the bench has no visible edge.
  function matTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2e34';
    g.fillRect(0, 0, 512, 512);
    // fine speckle so the surface reads as a material, not a flat colour
    const img = g.getImageData(0, 0, 512, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 10;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(255,255,255,0.045)';
    g.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(24, 24);          // one grid square is 1.6 units, about a centimetre
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.92, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.385;   // just under the board, which is 0.38 thick
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  // ── Resize ─────────────────────────────────────────────────
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  new ResizeObserver(resize).observe(container);

  // ── Exports ────────────────────────────────────────────────
  App.scene    = scene;
  App.camera   = camera;
  App.renderer = renderer;
  App.controls = controls;
  App.keyLight = key;

})(window.App = window.App || {});
