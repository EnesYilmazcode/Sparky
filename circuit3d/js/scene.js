// ─────────────────────────────────────────────────────────────
//  scene.js — Three.js scene, camera, renderer, lights
//  Attaches to window.App namespace
// ─────────────────────────────────────────────────────────────

(function (App) {

  const canvas    = document.getElementById('canvas');
  const container = document.getElementById('canvas-wrap');

  // ── Scene ──────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdcdad4); // warm gray workbench

  // ── Camera ─────────────────────────────────────────────────
  // Slightly elevated isometric-ish perspective, similar to Tinkercad
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
  camera.position.set(0, 22, 30);
  camera.lookAt(0, 0, 0);

  // ── Renderer ───────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // ── Orbit Controls ─────────────────────────────────────────
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping  = true;
  controls.dampingFactor  = 0.08;
  controls.maxPolarAngle  = Math.PI / 2.05;
  controls.minDistance    = 4;
  controls.maxDistance    = 70;
  controls.target.set(0, 0, 0);

  // ── Lighting ───────────────────────────────────────────────

  // Soft ambient fill
  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambient);

  // Main directional light (sun from upper right)
  const sun = new THREE.DirectionalLight(0xfffaf0, 1.1);
  sun.position.set(18, 35, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near   = 1;
  sun.shadow.camera.far    = 120;
  sun.shadow.camera.left   = -30;
  sun.shadow.camera.right  = 30;
  sun.shadow.camera.top    = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.bias = -0.0003;
  scene.add(sun);

  // Cool fill light from opposite side for softer shadows
  const fill = new THREE.DirectionalLight(0xd0e8ff, 0.35);
  fill.position.set(-12, 8, -8);
  scene.add(fill);

  // ── Ground / Workbench surface ─────────────────────────────
  const groundGeo = new THREE.PlaneGeometry(140, 140);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xcfccc6 });
  const ground    = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.21; // sits just under breadboard
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  // ── Resize handler ─────────────────────────────────────────
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  new ResizeObserver(resize).observe(container);

  // ── Exports ────────────────────────────────────────────────
  App.scene     = scene;
  App.camera    = camera;
  App.renderer  = renderer;
  App.controls  = controls;

})(window.App = window.App || {});
