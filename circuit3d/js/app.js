// ─────────────────────────────────────────────────────────────
//  app.js — State, placement, wire drawing, selection, render loop
// ─────────────────────────────────────────────────────────────

(function (App) {

  // ── Application State ───────────────────────────────────────
  App.state = {
    mode:             'select',
    pickedType:       null,
    placementRotation: 0,      // 0 = horizontal, 1 = vertical (toggled with R)
    wireStart:        null,    // { world, holeRef, pinMesh }
    tempWire:         null,    // dashed preview line
    wireColor:        0xef4444,
    selected:         null,    // { item, kind }
    components:       [],
    wires:            [],
    breadboard:       null,
    // Cached hover holes (set by interaction.js during hover)
    _hoverHoleA: null,
    _hoverHoleB: null,
  };

  // Span constants (exposed so interaction.js can read them)
  App.RESISTOR_SPAN = 4;   // columns (or rows) between leads — narrower
  App.LED_SPAN      = 2;

  const state = App.state;

  // ── Render Loop ─────────────────────────────────────────────

  function animate() {
    requestAnimationFrame(animate);
    App.controls.update();
    App.renderer.render(App.scene, App.camera);
  }

  // ── Sidebar ──────────────────────────────────────────────────

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

  // ── Mode ─────────────────────────────────────────────────────

  const MODE_HINTS = {
    select: 'Click a component or wire to select it · DEL to delete',
    place:  'Hover over the board to preview · Click to place · R to rotate · ESC to cancel',
    wire:   'Click any hole or gold pin to start a wire · click again to complete',
  };

  App.setMode = function (m) {
    if (m !== 'wire')   App.cancelWire();
    if (m !== 'select') App.deselect();
    state.mode = m;

    document.querySelectorAll('.mode-btn[data-mode]').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === m));
    document.querySelectorAll('.comp-item').forEach(b => {
      b.classList.toggle('active',
        (m === 'place' && b.dataset.type === state.pickedType) ||
        (m === 'wire'  && b.dataset.type === 'wire'));
    });

    document.getElementById('status-mode-badge').textContent = m.toUpperCase();
    document.getElementById('status-text').textContent       = MODE_HINTS[m] || '';
    document.getElementById('wire-color-row').style.display  = m === 'wire' ? 'block' : 'none';
    document.getElementById('rotate-badge').style.display    = m === 'place' ? 'block' : 'none';
    App.setHint(MODE_HINTS[m]);
  };

  function setMode(m) { App.setMode(m); }

  // ── Hint ─────────────────────────────────────────────────────

  let hintTimer = null;

  App.setHint = function (text, durationMs) {
    const box = document.getElementById('hint-box');
    document.getElementById('hint-text').textContent = text || '';
    box.className = text ? '' : 'hint-hidden';
    clearTimeout(hintTimer);
    if (durationMs) hintTimer = setTimeout(() => { box.className = 'hint-hidden'; }, durationMs);
  };

  // ── Placement ────────────────────────────────────────────────
  // Both placeResistor and placeLED now receive hole objects directly
  // (already resolved by interaction.js hover logic).

  App.placeResistor = function (holeA, holeB) {
    const { group, pins } = App.buildResistor(holeA, holeB);
    App.scene.add(group);
    const record = {
      type: 'resistor', group, pins, pinMeshes: [],
      holeRefs: [{ col: holeA.col, row: holeA.row },
                 { col: holeB.col, row: holeB.row }],
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  App.placeLED = function (holeA, holeB) {
    const { group, pins } = App.buildLED(holeA, holeB);
    App.scene.add(group);
    const record = {
      type: 'led', group, pins, pinMeshes: [],
      // pin 0 = cathode (−), pin 1 = anode (+)
      holeRefs: [{ col: holeA.col, row: holeA.row },   // cathode
                 { col: holeB.col, row: holeB.row }],   // anode
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  App.placeBattery = function (wx, wz) {
    const margin = state.breadboard.BOARD_W / 2 + 2.5;
    const placedX = wx >= 0 ? Math.max(wx, margin) : Math.min(wx, -margin);
    const { group, pins } = App.buildBattery(placedX, wz);
    App.scene.add(group);
    const record = {
      type: 'battery', group, pins, pinMeshes: [],
      holeRefs: null, // not on breadboard
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  // ── Pin Markers ──────────────────────────────────────────────

  const PIN_GEO = new THREE.SphereGeometry(0.10, 11, 11);
  const PIN_MAT = () => new THREE.MeshLambertMaterial({
    color: 0xf5c518, emissive: 0x3a2800, emissiveIntensity: 0.4,
  });

  function addPinMarkers(record) {
    record.pins.forEach((worldPos, idx) => {
      const pm = new THREE.Mesh(PIN_GEO, PIN_MAT());
      pm.position.copy(worldPos);
      pm.userData.ownerComp   = record;
      pm.userData.pinIndex    = idx;
      pm.userData.world       = worldPos.clone();
      pm.userData.isWireStart = false;
      App.scene.add(pm);
      record.pinMeshes.push(pm);
    });
  }

  // ── Wire Drawing ─────────────────────────────────────────────
  // endPin: { world: Vector3, holeRef: { col, row } | null }

  App.finishWire = function (endPin) {
    if (!state.wireStart) return;

    const startWorld  = state.wireStart.world;
    const endWorld    = endPin.world;
    const startHole   = state.wireStart.holeRef;
    const endHole     = endPin.holeRef;

    // Capture component-pin references for battery / off-board pins.
    // These let simulate.js connect free pins (e.g. battery terminals) to
    // the breadboard graph even though they carry no holeRef.
    const sPm = state.wireStart.pinMesh;
    const ePm = endPin.pinMesh || null;

    // Build the wire visual (coloured arc with leg stubs into holes)
    const wireGroup = buildWireGroup(startWorld, endWorld, state.wireColor);
    App.scene.add(wireGroup);

    // Reset start-pin highlight
    const sp = state.wireStart.pinMesh;
    if (sp) { sp.userData.isWireStart = false; sp.material.emissiveIntensity = 0.4; }

    state.wires.push({
      group:        wireGroup,
      startWorld,   endWorld,
      startHole,    endHole,          // breadboard hole refs (null for off-board pins)
      startComp:    sPm?.userData.ownerComp  ?? null,
      startPinIdx:  sPm?.userData.pinIndex   ?? -1,
      endComp:      ePm?.userData.ownerComp  ?? null,
      endPinIdx:    ePm?.userData.pinIndex   ?? -1,
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

  // Wire visual: colored arc + two leg stubs going into holes
  function buildWireGroup(start, end, hexColor) {
    const g   = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: hexColor });
    const LEG_H = 0.28;

    // Leg stubs only for board-level pins (y ≈ 0); skip for elevated terminals
    const legGeo = new THREE.CylinderGeometry(0.04, 0.04, LEG_H, 7);
    [start, end].forEach(p => {
      if (p.y > 0.15) return;   // battery/elevated pins — no leg into the board
      const leg = new THREE.Mesh(legGeo, mat.clone());
      leg.position.set(p.x, -LEG_H / 2 + 0.06, p.z);
      g.add(leg);
    });

    // Use actual pin height for arc endpoints (fall back to 0.06 for board holes)
    const startY = start.y > 0.15 ? start.y : 0.06;
    const endY   = end.y   > 0.15 ? end.y   : 0.06;

    // Arc body — mid-point rises above the higher of the two endpoints
    const dist = start.distanceTo(end);
    const mid  = new THREE.Vector3(
      (start.x + end.x) / 2,
      Math.max(startY, endY) + dist * 0.22 + 0.38,
      (start.z + end.z) / 2
    );
    const curve   = new THREE.CatmullRomCurve3([
      new THREE.Vector3(start.x, startY, start.z),
      mid,
      new THREE.Vector3(end.x,   endY,   end.z),
    ]);
    const tubeGeo = new THREE.TubeGeometry(curve, 26, 0.043, 7, false);
    const tube    = new THREE.Mesh(tubeGeo, mat.clone());
    tube.castShadow = true;
    g.add(tube);

    return g;
  }

  // ── Selection ────────────────────────────────────────────────

  const origEmissive = new Map();

  App.selectItem = function (item, kind) {
    App.deselect();
    state.selected = { item, kind };

    const root = kind === 'component' ? item.group : item.group;
    if (!root) return;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      origEmissive.set(obj, { hex: obj.material.emissive.getHex(), int: obj.material.emissiveIntensity });
      obj.material = obj.material.clone();
      obj.material.emissive.setHex(0x1a5a99);
      obj.material.emissiveIntensity = 0.65;
    });
  };

  App.deselect = function () {
    if (!state.selected) return;
    const { item, kind } = state.selected;
    const root = item.group;
    if (root) root.traverse(obj => {
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
      App.scene.remove(item.group);
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
    state.wires.forEach(w => App.scene.remove(w.group));
    state.components = [];
    state.wires      = [];
    refreshCounts();
  };

  // ── Helpers ───────────────────────────────────────────────────

  function refreshCounts() {
    const cc = document.getElementById('comp-count');
    const wc = document.getElementById('wire-count');
    if (cc) cc.textContent = state.components.length;
    if (wc) wc.textContent = state.wires.length;
  }

  // ── Boot ─────────────────────────────────────────────────────
  // Must run AFTER all App.* methods are defined above.
  state.breadboard = App.createBreadboard();
  App.scene.add(state.breadboard.group);
  App.initInteraction();
  initSidebar();
  setMode('select');
  animate();

})(window.App = window.App || {});
