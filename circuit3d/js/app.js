// ─────────────────────────────────────────────────────────────
//  app.js — Main application: state, UI, placement, wires,
//           selection, and the render loop.
//
//  This file ties together scene.js, breadboard.js,
//  components.js, interaction.js, and simulate.js.
// ─────────────────────────────────────────────────────────────

(function (App) {

  // ── Application State ───────────────────────────────────────
  App.state = {
    mode:        'select',   // 'select' | 'place' | 'wire'
    pickedType:  null,       // component type chosen from sidebar
    wireStart:   null,       // { world, pinMesh, comp, pinIndex }
    tempWire:    null,       // preview LINE while drawing wire
    wireColor:   0xef4444,   // current wire color (default red)
    selected:    null,       // { item, kind: 'component'|'wire' }
    components:  [],         // placed component records
    wires:       [],         // placed wire records
    breadboard:  null,
  };

  const state = App.state;

  // ── Boot ─────────────────────────────────────────────────────

  (function init() {
    state.breadboard = App.createBreadboard();
    App.scene.add(state.breadboard.group);

    App.initInteraction();
    initSidebar();
    animate();
  })();

  // ── Render Loop ─────────────────────────────────────────────

  function animate() {
    requestAnimationFrame(animate);
    App.controls.update();
    App.renderer.render(App.scene, App.camera);
  }

  // ── Sidebar UI ──────────────────────────────────────────────

  function initSidebar() {
    document.querySelectorAll('.comp-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        if (type === 'wire') {
          setMode('wire');
          document.getElementById('wire-color-row').style.display = 'block';
        } else {
          state.pickedType = type;
          setMode('place');
          document.getElementById('wire-color-row').style.display = 'none';
        }
      });
    });

    document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    document.querySelectorAll('.swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        state.wireColor = parseInt(sw.dataset.color, 16);
      });
    });
  }

  // ── Mode Management ─────────────────────────────────────────

  const MODE_HINTS = {
    select: 'Click a component or wire to select it · DEL to delete',
    place:  'Click the breadboard to place the selected component · ESC to cancel',
    wire:   'Click a gold pin to start a wire · click another pin to connect · ESC to cancel',
  };

  App.setMode = function setMode(m) {
    if (m !== 'wire')   App.cancelWire();
    if (m !== 'select') App.deselect();

    state.mode = m;

    document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === m);
    });

    document.querySelectorAll('.comp-item').forEach(btn => {
      const isActive =
        (m === 'place' && btn.dataset.type === state.pickedType) ||
        (m === 'wire'  && btn.dataset.type === 'wire');
      btn.classList.toggle('active', isActive);
    });

    document.getElementById('status-mode-badge').textContent = m.toUpperCase();
    document.getElementById('status-text').textContent       = MODE_HINTS[m] || '';

    document.getElementById('wire-color-row').style.display =
      m === 'wire' ? 'block' : 'none';

    App.setHint(MODE_HINTS[m]);
  };

  function setMode(m) { App.setMode(m); }

  // ── Hint Overlay ─────────────────────────────────────────────

  let hintTimer = null;

  App.setHint = function (text, durationMs) {
    const box = document.getElementById('hint-box');
    document.getElementById('hint-text').textContent = text || '';
    box.className = text ? '' : 'hint-hidden';
    clearTimeout(hintTimer);
    if (durationMs) hintTimer = setTimeout(() => { box.className = 'hint-hidden'; }, durationMs);
  };

  // ── Placement ───────────────────────────────────────────────

  const RESISTOR_SPAN = 5; // columns between resistor leads
  const LED_SPAN      = 2; // columns between LED leads

  App.placeResistor = function (col, row) {
    const bb   = state.breadboard;
    const colB = col + RESISTOR_SPAN;
    if (colB >= bb.COLS) return;

    const holeA = bb.getHole(col,  row);
    const holeB = bb.getHole(colB, row);
    if (!holeA || !holeB) return;

    const { group, pins } = App.buildResistor(holeA, holeB);
    App.scene.add(group);

    const record = {
      type:     'resistor',
      group, pins,
      pinMeshes: [],
      // Store hole references so the simulator can determine breadboard connectivity
      holeRefs: [{ col, row }, { col: colB, row }],
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  App.placeLED = function (col, row) {
    const bb   = state.breadboard;
    const colB = col + LED_SPAN;
    if (colB >= bb.COLS) return;

    const holeA = bb.getHole(col,  row);
    const holeB = bb.getHole(colB, row);
    if (!holeA || !holeB) return;

    const { group, pins } = App.buildLED(holeA, holeB);
    App.scene.add(group);

    const record = {
      type:     'led',
      group, pins,
      pinMeshes: [],
      // pin 0 = cathode (−), pin 1 = anode (+)
      holeRefs: [{ col, row }, { col: colB, row }],
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  App.placeBattery = function (wx, wz) {
    // Keep battery outside the breadboard area
    const placedX = wx > 0
      ? Math.max(wx, state.breadboard.BOARD_W / 2 + 2.5)
      : Math.min(wx, -(state.breadboard.BOARD_W / 2 + 2.5));

    const { group, pins } = App.buildBattery(placedX, wz);
    App.scene.add(group);

    const record = {
      type:     'battery',
      group, pins,
      pinMeshes: [],
      holeRefs:  null, // battery is not on the breadboard
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  // ── Pin Markers ─────────────────────────────────────────────
  // Small gold spheres shown at each component's electrical pin.
  // Clickable in wire mode to start/end a wire.

  const PIN_GEO = new THREE.SphereGeometry(0.10, 11, 11);
  const PIN_MAT = () => new THREE.MeshLambertMaterial({
    color: 0xf5c518, emissive: 0x3a2800, emissiveIntensity: 0.4,
  });

  function addPinMarkers(record) {
    record.pins.forEach((worldPos, idx) => {
      const pm = new THREE.Mesh(PIN_GEO, PIN_MAT());
      pm.position.copy(worldPos);
      pm.userData.ownerComp = record;
      pm.userData.pinIndex  = idx;
      pm.userData.world     = worldPos.clone();
      pm.userData.isWireStart = false;
      App.scene.add(pm);
      record.pinMeshes.push(pm);
    });
  }

  // ── Wire Drawing ─────────────────────────────────────────────

  // Called from interaction.js with the end-pin descriptor:
  //   { world, comp, pinIndex }
  App.finishWire = function (endPin) {
    if (!state.wireStart) return;

    const startWorld = state.wireStart.world;
    const endWorld   = endPin.world;

    const wireMesh = buildWireMesh(startWorld, endWorld, state.wireColor);
    App.scene.add(wireMesh);

    // Reset the start pin indicator
    const sp = state.wireStart.pinMesh;
    if (sp) { sp.userData.isWireStart = false; sp.material.emissiveIntensity = 0.4; }

    // Store component references so the simulator can trace connections
    state.wires.push({
      mesh:        wireMesh,
      startWorld,  endWorld,
      startComp:   state.wireStart.comp,
      startPinIdx: state.wireStart.pinIndex,
      endComp:     endPin.comp,
      endPinIdx:   endPin.pinIndex,
    });

    state.wireStart = null;
    if (state.tempWire) { App.scene.remove(state.tempWire); state.tempWire = null; }

    App.setHint(MODE_HINTS['wire']);
    refreshCounts();
  };

  App.cancelWire = function () {
    if (state.wireStart?.pinMesh) {
      state.wireStart.pinMesh.userData.isWireStart = false;
      state.wireStart.pinMesh.material.emissiveIntensity = 0.4;
    }
    state.wireStart = null;
    if (state.tempWire) { App.scene.remove(state.tempWire); state.tempWire = null; }
  };

  // Arc-shaped tube between two world positions
  function buildWireMesh(start, end, hexColor) {
    const mid  = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const dist = start.distanceTo(end);
    mid.y = Math.max(start.y, end.y) + dist * 0.18 + 0.5;

    const curve = new THREE.CatmullRomCurve3([start, mid, end]);
    const geo   = new THREE.TubeGeometry(curve, 28, 0.045, 7, false);
    const mat   = new THREE.MeshLambertMaterial({ color: hexColor });
    const mesh  = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  // ── Selection ────────────────────────────────────────────────

  const origEmissive = new Map();

  App.selectItem = function (item, kind) {
    App.deselect();
    state.selected = { item, kind };

    const root = kind === 'component' ? item.group : item.mesh;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      origEmissive.set(obj, { hex: obj.material.emissive.getHex(), int: obj.material.emissiveIntensity });
      obj.material = obj.material.clone();
      obj.material.emissive.setHex(0x1a5a99);
      obj.material.emissiveIntensity = 0.6;
    });
  };

  App.deselect = function () {
    if (!state.selected) return;
    const { item, kind } = state.selected;
    const root = kind === 'component' ? item.group : item.mesh;
    root.traverse(obj => {
      if (!obj.isMesh || !origEmissive.has(obj)) return;
      const { hex, int } = origEmissive.get(obj);
      obj.material.emissive.setHex(hex);
      obj.material.emissiveIntensity = int;
    });
    origEmissive.clear();
    state.selected = null;
  };

  // ── Delete ───────────────────────────────────────────────────

  App.deleteSelected = function () {
    if (!state.selected) return;
    const { item, kind } = state.selected;
    App.deselect();

    if (kind === 'component') {
      (item.pinMeshes || []).forEach(pm => App.scene.remove(pm));
      App.scene.remove(item.group);
      state.components = state.components.filter(c => c !== item);
    } else if (kind === 'wire') {
      App.scene.remove(item.mesh);
      state.wires = state.wires.filter(w => w !== item);
    }
    refreshCounts();
  };

  // ── Clear All ─────────────────────────────────────────────────

  App.clearAll = function () {
    App.stopSimulation?.();
    App.deselect();
    App.cancelWire();
    state.components.forEach(c => {
      (c.pinMeshes || []).forEach(pm => App.scene.remove(pm));
      App.scene.remove(c.group);
    });
    state.wires.forEach(w => App.scene.remove(w.mesh));
    state.components = [];
    state.wires      = [];
    refreshCounts();
  };

  // ── UI helpers ───────────────────────────────────────────────

  function refreshCounts() {
    document.getElementById('comp-count').textContent = state.components.length;
    document.getElementById('wire-count').textContent = state.wires.length;
  }

  // ── Init ─────────────────────────────────────────────────────
  setMode('select');

})(window.App = window.App || {});
