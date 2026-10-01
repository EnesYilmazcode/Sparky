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
    circuitName:      'Untitled',
    circuitId:        null,    // assigned on first auto-save
    // Cached hover holes (set by interaction.js during hover)
    _hoverHoleA: null,
    _hoverHoleB: null,
  };

  // ── Local project storage helpers ───────────────────────────
  const LS_KEY = 'sparky_local_projects';

  function lsProjects() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  }
  function lsSave(projects) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(projects)); } catch {}
  }

  // Find the next available "Untitled (N)" name
  function nextUntitledName() {
    const names = new Set(lsProjects().map(p => p.name));
    if (!names.has('Untitled')) return 'Untitled';
    let n = 1;
    while (names.has(`Untitled (${n})`)) n++;
    return `Untitled (${n})`;
  }

  // Span constants (exposed so interaction.js can read them)
  App.RESISTOR_SPAN = 4;   // columns (or rows) between leads — narrower
  App.LED_SPAN      = 2;
  App.BUZZER_SPAN   = 2;
  App.BUTTON_SPAN   = 3;

  const state = App.state;

  // ── Render Loop ─────────────────────────────────────────────

  // Narrow screens need the camera further back to fit the board's width.
  const _aspect = () => Math.max(0.45, App.camera.aspect || 1.6);
  const _defaultCamPos = {};
  function _fitDefault() {
    const k = Math.max(1, 1.55 / _aspect());
    Object.assign(_defaultCamPos, { x: 0, y: 18 * k, z: 24 * k });
  }
  _fitDefault();
  const _defaultCamTgt = { x: 0, y: 0, z: 0 };
  const _camThreshold = 0.5;

  function _isCamDefault() {
    const p = App.camera.position, t = App.controls.target;
    return Math.abs(p.x - _defaultCamPos.x) < _camThreshold &&
           Math.abs(p.y - _defaultCamPos.y) < _camThreshold &&
           Math.abs(p.z - _defaultCamPos.z) < _camThreshold &&
           Math.abs(t.x - _defaultCamTgt.x) < _camThreshold &&
           Math.abs(t.y - _defaultCamTgt.y) < _camThreshold &&
           Math.abs(t.z - _defaultCamTgt.z) < _camThreshold;
  }

  // Per-frame callbacks (buzzer shake, hover pulse). Each gets seconds.
  const _tickers = new Set();
  App.addTicker    = fn => _tickers.add(fn);
  App.removeTicker = fn => _tickers.delete(fn);

  function animate() {
    requestAnimationFrame(animate);
    const t = performance.now() / 1000;
    _tickers.forEach(fn => { try { fn(t); } catch (e) { console.warn(e); } });
    App.controls.update();
    App.renderer.render(App.scene, App.camera);

    const resetBtn = document.getElementById('reset-cam-btn');
    if (resetBtn) resetBtn.style.display = _isCamDefault() ? 'none' : 'flex';
  }

  // Glide the camera back to the default view.
  App.resetView = function () {
    _fitDefault();
    const cam = App.camera, ctl = App.controls;
    const p0 = cam.position.clone(), t0 = ctl.target.clone();
    const p1 = new THREE.Vector3(_defaultCamPos.x, _defaultCamPos.y, _defaultCamPos.z);
    const t1 = new THREE.Vector3(_defaultCamTgt.x, _defaultCamTgt.y, _defaultCamTgt.z);
    const start = performance.now(), dur = 650;
    const step = now => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      cam.position.lerpVectors(p0, p1, e);
      ctl.target.lerpVectors(t0, t1, e);
      ctl.update();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

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
    select: '',
    place:  'Click a hole to place it · R rotates',
    wire:   'Click two holes to wire them',
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

  // ── Occupancy: one lead or wire end per hole ─────────────────
  App.occupiedKeys = function () {
    const set = new Set();
    state.components.forEach(c => (c.holeRefs || []).forEach(h => set.add(h.row + ':' + h.col)));
    state.wires.forEach(w => {
      if (w.startHole) set.add(w.startHole.row + ':' + w.startHole.col);
      if (w.endHole)   set.add(w.endHole.row + ':' + w.endHole.col);
    });
    return set;
  };

  // Would a part at these holes intersect a part already on the board?
  // Compares footprints on the board plane, leads excluded, shrunk a hair
  // so parts in neighbouring rows (which do fit on a real board) pass.
  const _probe = new THREE.Box3(), _other = new THREE.Box3();
  function bodyBox(group, box) {
    box.makeEmpty();
    group.updateMatrixWorld(true);
    group.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      if (o.geometry.type === 'TubeGeometry') return;           // leads and wires
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    return box.expandByScalar(-0.03);
  }
  App.overlapsPart = function (type, holeA, holeB) {
    const build = { resistor: App.buildResistor, led: App.buildLED, buzzer: App.buildBuzzer, button: App.buildButton }[type];
    if (!build) return false;
    const probe = build(holeA, holeB).group;
    bodyBox(probe, _probe);
    App.disposeGroup(probe);
    return state.components.some(c => {
      if (!c.holeRefs) return false;
      bodyBox(c.group, _other);
      return _probe.max.x > _other.min.x && _probe.min.x < _other.max.x &&
             _probe.max.z > _other.min.z && _probe.min.z < _other.max.z;
    });
  };

  App.isHoleFree = function (hole) {
    return !!hole && !App.occupiedKeys().has(hole.row + ':' + hole.col);
  };

  // Nearest free hole on the same strip (same column half, or same rail).
  App.freeHoleOnStrip = function (hole) {
    if (!hole) return null;
    const taken = App.occupiedKeys();
    const ref = window.BoardModel.freeHoleNear({ col: hole.col, row: hole.row }, taken);
    return ref ? state.breadboard.getHole(ref.col, ref.row) : null;
  };

  App.placeResistor = function (holeA, holeB, values) {
    pushHistory();
    const vals = App.componentValues('resistor', values);
    const { group, pins } = App.buildResistor(holeA, holeB, vals.resistance);
    App.scene.add(group);
    const record = {
      type: 'resistor', group, pins, pinMeshes: [], values: vals,
      holeRefs: [{ col: holeA.col, row: holeA.row },
                 { col: holeB.col, row: holeB.row }],
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  App.placeLED = function (holeA, holeB, values) {
    pushHistory();
    const vals = App.componentValues('led', values);
    const { group, pins } = App.buildLED(holeA, holeB, vals.color);
    App.scene.add(group);
    const record = {
      type: 'led', group, pins, pinMeshes: [], values: vals,
      // pin 0 = cathode (−), pin 1 = anode (+)
      holeRefs: [{ col: holeA.col, row: holeA.row },   // cathode
                 { col: holeB.col, row: holeB.row }],   // anode
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  App.placeBuzzer = function (holeA, holeB, values) {
    pushHistory();
    const { group, pins } = App.buildBuzzer(holeA, holeB);
    App.scene.add(group);
    const record = {
      type: 'buzzer', group, pins, pinMeshes: [],
      values: App.componentValues('buzzer', values),
      holeRefs: [{ col: holeA.col, row: holeA.row },
                 { col: holeB.col, row: holeB.row }],
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  App.placeButton = function (holeA, holeB, values) {
    pushHistory();
    const { group, pins, capMesh } = App.buildButton(holeA, holeB);
    App.scene.add(group);
    const record = {
      type: 'button', group, pins, pinMeshes: [],
      values: App.componentValues('button', values),
      holeRefs: [{ col: holeA.col, row: holeA.row },
                 { col: holeB.col, row: holeB.row }],
      pressed: false,
      capMesh,
    };
    if (capMesh) capMesh.userData.ownerComp = record;
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  // ── Toggle button pressed state ──────────────────────────────
  // Animates the cap smoothly down (press) or back up (release).
  App.toggleButton = function (comp) {
    if (comp.type !== 'button') return;
    comp.pressed = !comp.pressed;

    const cap = comp.capMesh;
    if (cap) {
      // Ensure the cap has its own material so we can tint it independently
      if (!cap.userData.matCloned) {
        cap.material = cap.material.clone();
        cap.userData.matCloned = true;
      }

      const targetY   = comp.pressed ? cap.userData.capPressY : cap.userData.capRestY;
      const targetCol = comp.pressed ? 0x22c55e : (cap.userData.restColor ?? 0x2b2e35);
      const targetEmi = comp.pressed ? 0x15803d : 0x000000;
      const targetEmiI = comp.pressed ? 0.8 : 0;

      // Kill any in-progress animation on this cap
      if (cap.userData._animId) cancelAnimationFrame(cap.userData._animId);

      const startY   = cap.position.y;
      const startCol = cap.material.color.getHex();
      const startEmi = cap.material.emissive.getHex();
      const startEmiI = cap.material.emissiveIntensity;
      const duration  = 80; // ms — snappy but visible
      const t0        = performance.now();

      const colA = new THREE.Color().setHex(startCol);
      const colB = App.lin(targetCol);
      const emiA = new THREE.Color().setHex(startEmi);
      const emiB = App.lin(targetEmi);

      function tick(now) {
        const p = Math.min((now - t0) / duration, 1);
        // Ease out cubic
        const e = 1 - Math.pow(1 - p, 3);

        cap.position.y = startY + (targetY - startY) * e;
        cap.material.color.lerpColors(colA, colB, e);
        cap.material.emissive.lerpColors(emiA, emiB, e);
        cap.material.emissiveIntensity = startEmiI + (targetEmiI - startEmiI) * e;

        if (p < 1) {
          cap.userData._animId = requestAnimationFrame(tick);
        } else {
          cap.userData._animId = null;
        }
      }

      cap.userData._animId = requestAnimationFrame(tick);
    }

  };

  // Where the AI puts its n-th battery: beside the left end of the board,
  // next to column 1 where its recipe lands the rail wires.
  App.batterySlot = function (n) {
    const x = -(state.breadboard.BOARD_W / 2 + 2.6 + Math.floor(n / 2) * 3.4);
    return { x, z: (n % 2 === 0 ? -1.4 : 1.6) };
  };

  App.placeBattery = function (wx, wz, values) {
    pushHistory();
    const margin = state.breadboard.BOARD_W / 2 + 2.2;
    const placedX = wx >= 0 ? Math.max(wx, margin) : Math.min(wx, -margin);
    const { group, pins } = App.buildBattery(placedX, wz);
    App.scene.add(group);
    const record = {
      type: 'battery', group, pins, pinMeshes: [],
      values: App.componentValues('battery', values),
      holeRefs: null, // not on breadboard
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  // ── Pin Markers ──────────────────────────────────────────────

  // Board parts are wired through the holes beside their leads, so only
  // off-board pins (the battery terminals) need something to click. The
  // target is invisible; wire mode shows a ring on it.
  const PIN_GEO = new THREE.SphereGeometry(0.34, 16, 12);
  const PIN_MAT = new THREE.MeshBasicMaterial({ visible: false });

  function addPinMarkers(record) {
    if (record.holeRefs) return;
    record.pins.forEach((worldPos, idx) => {
      const pm = new THREE.Mesh(PIN_GEO, PIN_MAT);
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
    pushHistory();

    const startWorld  = state.wireStart.world;
    const endWorld    = endPin.world;
    const startHole   = state.wireStart.holeRef;
    const endHole     = endPin.holeRef;

    // Capture component-pin references for battery / off-board pins.
    // These let simulate.js connect free pins (e.g. battery terminals) to
    // the breadboard graph even though they carry no holeRef.
    const sPm = state.wireStart.pinMesh;
    const ePm = endPin.pinMesh || null;

    const wireGroup = App.buildWire(startWorld, endWorld, state.wireColor);
    wireGroup.userData.color = state.wireColor;
    App.scene.add(wireGroup);

    const sp = state.wireStart.pinMesh;
    if (sp) sp.userData.isWireStart = false;

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
    if (state.wireStart?.pinMesh) state.wireStart.pinMesh.userData.isWireStart = false;
    state.wireStart = null;
    if (state.tempWire) { App.scene.remove(state.tempWire); state.tempWire = null; }
  };

  // ── Selection ────────────────────────────────────────────────

  App.selectItem = function (item, kind) {
    App.deselect();
    state.selected = { item, kind };
    if (item.group) App.setHighlight(item.group, true);
    App.showInspector?.(item, kind);
  };

  App.deselect = function () {
    if (!state.selected) return;
    const { item } = state.selected;
    if (item.group) App.setHighlight(item.group, false);
    state.selected = null;
    App.hideInspector?.();
  };

  // Give a placed part new values (resistance, LED colour). The model is
  // rebuilt in place, because a resistor's colour bands are geometry.
  App.setComponentValues = function (comp, patch) {
    if (!comp || !comp.holeRefs) return;
    pushHistory();
    const wasSelected = state.selected?.item === comp;
    if (wasSelected) App.setHighlight(comp.group, false);
    comp.values = App.componentValues(comp.type, Object.assign({}, comp.values, patch,
      comp.type === 'led' && patch.color ? { forwardVoltage: undefined } : {}));
    if (comp.type === 'led' && comp.values.forwardVoltage == null) comp.values = App.componentValues('led', { color: comp.values.color });
    const hA = state.breadboard.getHole(comp.holeRefs[0].col, comp.holeRefs[0].row);
    const hB = state.breadboard.getHole(comp.holeRefs[1].col, comp.holeRefs[1].row);
    const built = comp.type === 'resistor' ? App.buildResistor(hA, hB, comp.values.resistance)
                : comp.type === 'led'      ? App.buildLED(hA, hB, comp.values.color) : null;
    if (!built) return;
    App.scene.remove(comp.group);
    App.disposeGroup(comp.group);
    comp.group = built.group;
    App.scene.add(comp.group);
    if (wasSelected) App.setHighlight(comp.group, true);
    refreshCounts();
    if (App.simRunning) App.runSimulation();
  };

  // Run many board edits as one undo step (an AI build is one change).
  App.batch = function (fn) {
    pushHistory();
    _historyMuted = true;
    try { fn(); } finally { _historyMuted = false; }
    refreshCounts();
  };

  // Remove a part, its off-board pin targets, and wires tied to its pins.
  App.removeComponent = function (comp) {
    if (!comp) return false;
    if (state.selected?.item === comp) App.deselect();
    (comp.pinMeshes || []).forEach(pm => App.scene.remove(pm));
    comp.group.userData.setActive?.(false);
    App.scene.remove(comp.group);
    App.disposeGroup(comp.group);
    state.components = state.components.filter(c => c !== comp);
    state.wires = state.wires.filter(w => {
      if (w.startComp !== comp && w.endComp !== comp) return true;
      App.scene.remove(w.group);
      App.disposeGroup(w.group);
      return false;
    });
    return true;
  };

  App.removeWire = function (wire) {
    if (!wire) return false;
    if (state.selected?.item === wire) App.deselect();
    App.scene.remove(wire.group);
    App.disposeGroup(wire.group);
    state.wires = state.wires.filter(w => w !== wire);
    return true;
  };

  // ── Delete ───────────────────────────────────────────────────

  App.deleteSelected = function () {
    if (!state.selected) return;
    const { item, kind } = state.selected;
    pushHistory();
    App.deselect();

    if (kind === 'component') App.removeComponent(item);
    else if (kind === 'wire') App.removeWire(item);
    refreshCounts();

    // Re-evaluate simulation with the remaining circuit
    if (App.simRunning) App.runSimulation();
  };

  // ── Save / Load ──────────────────────────────────────────────

  // ── Isometric thumbnail capture ──────────────────────────────
  function captureIsometricThumb() {
    // Stash camera
    const prevPos    = App.camera.position.clone();
    const prevTarget = App.controls.target.clone();

    // Isometric view
    App.camera.position.set(20, 22, 20);
    App.controls.target.set(0, 0, 0);
    App.camera.lookAt(0, 0, 0);
    App.renderer.render(App.scene, App.camera);

    // Downsample to 320-wide thumbnail
    const src = App.renderer.domElement;
    const scale = Math.min(1, 320 / src.width);
    const th  = document.createElement('canvas');
    th.width  = Math.round(src.width  * scale);
    th.height = Math.round(src.height * scale);
    th.getContext('2d').drawImage(src, 0, 0, th.width, th.height);
    const dataURL = th.toDataURL('image/jpeg', 0.72);

    // Restore camera
    App.camera.position.copy(prevPos);
    App.controls.target.copy(prevTarget);
    App.camera.lookAt(prevTarget);
    App.controls.update();

    return dataURL;
  }

  App.saveCircuit = function () {
    const name = state.circuitName || 'Untitled';

    // Build a raw serializable state (cols/rows, not world coords)
    const data = {
      version:   1,
      name,
      thumbnail: captureIsometricThumb(),
      components: state.components.map((c, i) => ({
        type:     c.type,
        id:       c.type + '_' + i,
        values:   c.values,
        holeRefs: c.holeRefs,          // null for battery
        position: c.group
          ? { x: +c.group.position.x.toFixed(3), z: +c.group.position.z.toFixed(3) }
          : null,
      })),
      wires: state.wires.map(w => ({
        startHole:   w.startHole,
        endHole:     w.endHole,
        startCompIdx: w.startComp ? state.components.indexOf(w.startComp) : -1,
        startPinIdx:  w.startPinIdx,
        endCompIdx:   w.endComp   ? state.components.indexOf(w.endComp)   : -1,
        endPinIdx:    w.endPinIdx,
        color:        w.group?.userData?.color ?? state.wireColor,
      })),
    };

    // Also ensure the local project entry is up-to-date
    if (state.circuitId) _doAutoSave();

    const safeName = name.replace(/[^\w\s\-]/g, '').trim() || 'circuit';
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = safeName + '.sparky';
    a.click();
    URL.revokeObjectURL(url);
    App.setHint(`Saved "${name}"`, 2500);
  };

  // ── Internal: load a parsed circuit data object onto the board ─
  App.loadCircuitData = function (data) {
    App.clearAll();
    restoreBoard(data);

    // Sync circuit name + ID
    if (data.name) {
      state.circuitName = data.name;
      const nf = document.getElementById('circuit-name-field');
      if (nf) nf.textContent = data.name;
    }
    if (data.id) state.circuitId = data.id;

    App.setHint(`Opened "${data.name || 'circuit'}"`, 2000);
  };

  // Replaying a board re-runs the place/wire helpers, which would each record
  // an undo entry of their own. The caller records one entry for the replay.
  function restoreBoard(data) {
    _historyMuted = true;
    try { rebuildBoard(data); } finally { _historyMuted = false; }
  }

  // Rebuild components and wires from serialized data onto a cleared board.
  function rebuildBoard(data) {
    const bb = state.breadboard;

    // Rebuild components
    const rebuilt = [];
    for (const c of (data.components || [])) {
      if (c.type === 'resistor' && c.holeRefs?.length === 2) {
        const hA = bb.getHole(c.holeRefs[0].col, c.holeRefs[0].row);
        const hB = bb.getHole(c.holeRefs[1].col, c.holeRefs[1].row);
        if (hA && hB) App.placeResistor(hA, hB, c.values);
      } else if (c.type === 'led' && c.holeRefs?.length === 2) {
        const hA = bb.getHole(c.holeRefs[0].col, c.holeRefs[0].row);
        const hB = bb.getHole(c.holeRefs[1].col, c.holeRefs[1].row);
        if (hA && hB) App.placeLED(hA, hB, c.values);
      } else if (c.type === 'buzzer' && c.holeRefs?.length === 2) {
        const hA = bb.getHole(c.holeRefs[0].col, c.holeRefs[0].row);
        const hB = bb.getHole(c.holeRefs[1].col, c.holeRefs[1].row);
        if (hA && hB) App.placeBuzzer(hA, hB, c.values);
      } else if (c.type === 'button' && c.holeRefs?.length === 2) {
        const hA = bb.getHole(c.holeRefs[0].col, c.holeRefs[0].row);
        const hB = bb.getHole(c.holeRefs[1].col, c.holeRefs[1].row);
        if (hA && hB) App.placeButton(hA, hB, c.values);
      } else if (c.type === 'battery' && c.position) {
        App.placeBattery(c.position.x, c.position.z, c.values);
      }
      rebuilt.push(state.components[state.components.length - 1]);
    }

    // Rebuild wires
    const savedColor = state.wireColor;
    for (const w of (data.wires || [])) {
      state.wireColor = w.color ?? 0xef4444;

      let startWorld = null, startHole = null, startPinMesh = null;
      let endWorld   = null, endHole   = null, endPinMesh   = null;

      if (w.startHole) {
        const h = bb.getHole(w.startHole.col, w.startHole.row);
        if (h) { startWorld = h.world.clone(); startHole = { col: h.col, row: h.row }; }
      } else if (w.startCompIdx >= 0 && rebuilt[w.startCompIdx]) {
        const comp = rebuilt[w.startCompIdx];
        const pm   = comp.pinMeshes[w.startPinIdx];
        if (pm) { startWorld = pm.userData.world.clone(); startPinMesh = pm; }
      }

      if (w.endHole) {
        const h = bb.getHole(w.endHole.col, w.endHole.row);
        if (h) { endWorld = h.world.clone(); endHole = { col: h.col, row: h.row }; }
      } else if (w.endCompIdx >= 0 && rebuilt[w.endCompIdx]) {
        const comp = rebuilt[w.endCompIdx];
        const pm   = comp.pinMeshes[w.endPinIdx];
        if (pm) { endWorld = pm.userData.world.clone(); endPinMesh = pm; }
      }

      if (startWorld && endWorld) {
        state.wireStart = { world: startWorld, holeRef: startHole, pinMesh: startPinMesh };
        App.finishWire({ world: endWorld, holeRef: endHole, pinMesh: endPinMesh });
      }
    }
    state.wireColor = savedColor;
  }

  App.loadCircuit = function () {
    const inp = document.createElement('input');
    inp.type   = 'file';
    inp.accept = '.sparky,.json';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      const text = await file.text();
      let data;
      try { data = JSON.parse(text); }
      catch { App.setHint('Not a .sparky file', 2500); return; }
      _showLoadPreview(data);
    };
    inp.click();
  };

  function _showLoadPreview(data) {
    const modal  = document.getElementById('load-preview-modal');
    const img    = document.getElementById('lpm-img');
    const ph     = document.getElementById('lpm-placeholder');
    const nameEl = document.getElementById('lpm-name');
    const metaEl = document.getElementById('lpm-meta');
    const btn    = document.getElementById('lpm-confirm');

    const name = data.name || 'Untitled';
    nameEl.textContent = name;

    const cc = data.components?.length ?? 0;
    const wc = data.wires?.length ?? 0;
    metaEl.textContent = `${cc} component${cc !== 1 ? 's' : ''} · ${wc} wire${wc !== 1 ? 's' : ''}`;

    if (data.thumbnail) {
      img.src = data.thumbnail;
      img.style.display = 'block';
      ph.style.display  = 'none';
    } else {
      img.style.display = 'none';
      ph.style.display  = 'flex';
    }

    btn.onclick = () => {
      modal.style.display = 'none';
      App.loadCircuitData(data);
    };

    modal.style.display = 'flex';
  }

  // ── Ids and the plain-data board ─────────────────────────────
  //  Ids count per type in placement order (led_0, led_1, battery_0),
  //  the same rule board-model.js and the server use.
  App.componentIds = function () {
    const seen = {};
    return state.components.map(c => {
      const k = seen[c.type] || 0;
      seen[c.type] = k + 1;
      return c.type + '_' + k;
    });
  };

  const COLOR_NAMES = { 0xef4444: 'red', 0xfbbf24: 'yellow', 0x22c55e: 'green', 0x3b82f6: 'blue',
                        0x111111: 'black', 0x000000: 'black', 0xffffff: 'white' };

  App.wireLabels = function (w) {
    const ids = App.componentIds();
    return [wireEndLabel(w, 'start', ids), wireEndLabel(w, 'end', ids)];
  };

  function wireEndLabel(w, side, ids) {
    const hole = side === 'start' ? w.startHole : w.endHole;
    if (hole) return App.formatHole(hole);
    const comp = side === 'start' ? w.startComp : w.endComp;
    const pin  = side === 'start' ? w.startPinIdx : w.endPinIdx;
    const i = state.components.indexOf(comp);
    return i >= 0 ? `${ids[i]}_pin${pin}` : null;
  }

  // What the AI and the server read: board-model.js export format.
  App.exportBoard = function () {
    const ids = App.componentIds();
    return {
      components: state.components.map(c => {
        const o = { type: c.type, holes: c.holeRefs ? c.holeRefs.map(App.formatHole) : null, values: c.values };
        if (c.type === 'button') o.pressed = !!c.pressed;
        return o;
      }),
      wires: state.wires.map(w => ({
        from:  wireEndLabel(w, 'start', ids),
        to:    wireEndLabel(w, 'end', ids),
        color: COLOR_NAMES[w.group?.userData?.color] || 'red',
      })).filter(w => w.from && w.to),
    };
  };

  // ── Markdown Export (human-readable for AI) ──────────────────
  App.exportMarkdown = function () {
    const comps = state.components;
    const wires = state.wires;
    const ids   = App.componentIds();

    const isEmpty = !comps.length && !wires.length;
    let md = isEmpty
      ? '**Board status: EMPTY. No components or wires placed yet.**\n\n'
      : `**Board status: ${comps.length} component(s), ${wires.length} wire(s).**\n\n`;

    md += '## Components\n';
    if (!comps.length) {
      md += '_None._\n';
    } else {
      md += '| id | type | value | pin_A | pin_B |\n';
      md += '|----|------|-------|-------|-------|\n';
      comps.forEach((c, i) => {
        const id = ids[i];
        let pA = '—', pB = '—';
        if (c.holeRefs) {
          pA = App.formatHole(c.holeRefs[0]);
          pB = App.formatHole(c.holeRefs[1]);
          if (c.type === 'led') { pA += ' (cathode −)'; pB += ' (anode +)'; }
          if (c.type === 'button') pB += c.pressed ? ' (pressed)' : '';
        } else {
          pA = `off-board + → wire ref: ${id}_pin0`;
          pB = `off-board − → wire ref: ${id}_pin1`;
        }
        md += `| ${id} | ${c.type} | ${App.formatValue(c) || '—'} | ${pA} | ${pB} |\n`;
      });
    }

    md += '\n## Wires\n';
    if (!wires.length) {
      md += '_None._\n';
    } else {
      md += '| from | to | color |\n';
      md += '|------|----|-------|\n';
      wires.forEach(w => {
        const from = wireEndLabel(w, 'start', ids) || '?';
        const to   = wireEndLabel(w, 'end', ids) || '?';
        md += `| ${from} | ${to} | ${COLOR_NAMES[w.group?.userData?.color] || 'red'} |\n`;
      });
    }

    md += '\n' + App.boardTopologyText() + '\n';
    return md;
  };

  // ── Export State (compact, for tools and tests) ──────────────
  App.exportState = function () {
    const ids = App.componentIds();
    const components = state.components.map((c, i) => {
      const obj = { type: c.type.toUpperCase(), id: ids[i] };
      if (c.holeRefs) obj.holes = c.holeRefs.map(App.formatHole);
      else if (c.group) obj.position = { x: +c.group.position.x.toFixed(2), z: +c.group.position.z.toFixed(2) };
      const v = c.values || App.componentValues(c.type);
      if (c.type === 'led') { obj.color = v.color; obj.value = v.forwardVoltage + 'V'; }
      else if (c.type === 'resistor' || c.type === 'buzzer') obj.value = v.resistance + 'Ω';
      else if (c.type === 'battery') obj.value = v.voltage + 'V';
      return obj;
    });
    const wires = state.wires.map(w => ({ from: wireEndLabel(w, 'start', ids), to: wireEndLabel(w, 'end', ids) }));
    return { components, wires };
  };

  // ── Clear All ─────────────────────────────────────────────────

  // Tear down every scene object, leaving the circuit's name and ID alone.
  function clearBoard() {
    App.stopSimulation?.();
    App.deselect();
    App.cancelWire();
    state.components.forEach(c => {
      (c.pinMeshes || []).forEach(pm => App.scene.remove(pm));
      c.group.userData.setActive?.(false);
      App.scene.remove(c.group);
      App.disposeGroup(c.group);
    });
    state.wires.forEach(w => { App.scene.remove(w.group); App.disposeGroup(w.group); });
    state.components = [];
    state.wires      = [];
  }

  App.clearBoard = clearBoard;   // empties the board, keeps the circuit's name

  App.clearAll = function () {
    pushHistory();
    clearBoard();
    // New blank circuit — get a fresh ID and name
    state.circuitId   = null;
    const newName = nextUntitledName();
    state.circuitName = newName;
    const nf = document.getElementById('circuit-name-field');
    if (nf) nf.textContent = newName;
    refreshCounts();
  };

  // ── Undo / Redo ───────────────────────────────────────────────
  // Every board-changing command snapshots the board before it runs, and undo
  // replays a snapshot rather than inverting the command. Replaying rebuilds
  // the wire-to-component references from scratch, which inverting cannot do
  // once a component record has been thrown away.

  const HISTORY_LIMIT = 60;
  const undoStack = [];
  const redoStack = [];
  let _historyMuted = false;

  function serializeBoard() {
    return {
      components: state.components.map(c => ({
        type:     c.type,
        values:   c.values,
        holeRefs: c.holeRefs,
        position: c.group ? { x: +c.group.position.x.toFixed(3), z: +c.group.position.z.toFixed(3) } : null,
      })),
      wires: state.wires.map(w => ({
        startHole:    w.startHole,
        endHole:      w.endHole,
        startCompIdx: w.startComp ? state.components.indexOf(w.startComp) : -1,
        startPinIdx:  w.startPinIdx,
        endCompIdx:   w.endComp   ? state.components.indexOf(w.endComp)   : -1,
        endPinIdx:    w.endPinIdx,
        color:        w.group?.userData?.color ?? state.wireColor,
      })),
    };
  }

  function newCircuitId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function snapshot() {
    // Mint the id now if the autosave has not yet. A snapshot carrying a null
    // id would, once undone, make the next autosave file a second project row
    // for the same circuit.
    if (!state.circuitId) state.circuitId = newCircuitId();
    const snap = serializeBoard();
    snap.id   = state.circuitId;
    snap.name = state.circuitName;
    return snap;
  }

  function pushHistory() {
    if (_historyMuted) return;
    undoStack.push(snapshot());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
  }

  function applySnapshot(snap) {
    clearBoard();
    restoreBoard(snap);
    state.circuitId   = snap.id;
    state.circuitName = snap.name;
    const nf = document.getElementById('circuit-name-field');
    if (nf) nf.textContent = snap.name;
    refreshCounts();
  }

  App.undo = function () {
    if (!undoStack.length) { App.setHint('Nothing to undo', 1500); return; }
    redoStack.push(snapshot());
    applySnapshot(undoStack.pop());
    App.setHint('Undone', 1200);
  };

  App.redo = function () {
    if (!redoStack.length) { App.setHint('Nothing to redo', 1500); return; }
    undoStack.push(snapshot());
    applySnapshot(redoStack.pop());
    App.setHint('Redone', 1200);
  };

  // ── Helpers ───────────────────────────────────────────────────

  // ── Auto-save to localStorage ─────────────────────────────
  let _autoSaveTimer = null;
  function scheduleAutoSave() {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(_doAutoSave, 800);
  }
  App.scheduleAutoSave = scheduleAutoSave;

  function _doAutoSave() {
    if (!state.components.length && !state.wires.length) return; // nothing to save

    if (!state.circuitId) {
      state.circuitId = newCircuitId();
    }

    // Lightweight thumbnail for auto-save (smaller than download)
    let thumb = null;
    try {
      const prevPos    = App.camera.position.clone();
      const prevTarget = App.controls.target.clone();
      App.camera.position.set(20, 22, 20);
      App.controls.target.set(0, 0, 0);
      App.camera.lookAt(0, 0, 0);
      App.renderer.render(App.scene, App.camera);
      const src = App.renderer.domElement;
      const th  = document.createElement('canvas');
      th.width  = 240; th.height = Math.round(240 * src.height / src.width);
      th.getContext('2d').drawImage(src, 0, 0, th.width, th.height);
      thumb = th.toDataURL('image/jpeg', 0.55);
      App.camera.position.copy(prevPos);
      App.controls.target.copy(prevTarget);
      App.camera.lookAt(prevTarget);
      App.controls.update();
    } catch {}

    const board = serializeBoard();
    const entry = {
      id:         state.circuitId,
      name:       state.circuitName,
      thumbnail:  thumb,
      updatedAt:  new Date().toISOString(),
      components: board.components,
      wires:      board.wires,
    };

    const projects = lsProjects();
    const idx = projects.findIndex(p => p.id === state.circuitId);
    if (idx >= 0) projects[idx] = entry; else projects.unshift(entry);
    lsSave(projects);
  }

  function refreshCounts() {
    const cc = document.getElementById('comp-count');
    const wc = document.getElementById('wire-count');
    if (cc) cc.textContent = state.components.length;
    if (wc) wc.textContent = state.wires.length;

    const clearBtn = document.getElementById('clear-all-btn');
    const empty = !state.components.length && !state.wires.length;
    if (clearBtn) clearBtn.style.display = empty ? 'none' : 'flex';
    const es = document.getElementById('empty-state');
    if (es) es.style.display = empty && !App.previewing ? 'block' : 'none';

    scheduleAutoSave();
  }
  App.refreshCounts = refreshCounts;

  // ── Boot ─────────────────────────────────────────────────────
  // Must run AFTER all App.* methods are defined above.
  App.camera.position.set(_defaultCamPos.x, _defaultCamPos.y, _defaultCamPos.z);
  state.breadboard = App.createBreadboard();
  App.scene.add(state.breadboard.group);
  App.initInteraction();
  initSidebar();
  setMode('select');
  animate();

  document.getElementById('load-demo-btn')?.addEventListener('click', () => {
    fetch('../demo.sparky').then(r => r.json()).then(data => {
      data.name = 'Demo';
      delete data.id;
      App.loadCircuitData(data);
    }).catch(() => App.setHint('Could not load the demo circuit', 2500));
  });
  refreshCounts();

  // Auto-load circuit passed from dashboard via sessionStorage
  const _pending = sessionStorage.getItem('sparky_load_circuit');
  if (_pending) {
    sessionStorage.removeItem('sparky_load_circuit');
    try {
      const loaded = JSON.parse(_pending);
      // Restore project ID so auto-save updates the same entry
      if (loaded.id) state.circuitId = loaded.id;
      App.loadCircuitData(loaded);
      clearHistory();   // the opened circuit is the starting point, not an edit
    } catch (e) { console.warn('Auto-load failed', e); }
  } else {
    // New circuit — pick an auto-incremented untitled name
    const name = nextUntitledName();
    state.circuitName = name;
    const nf = document.getElementById('circuit-name-field');
    if (nf) nf.textContent = name;
  }

})(window.App = window.App || {});
