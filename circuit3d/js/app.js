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
  App.BUZZER_SPAN   = 2;
  App.BUTTON_SPAN   = 3;

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

  App.placeBuzzer = function (holeA, holeB) {
    const { group, pins } = App.buildBuzzer(holeA, holeB);
    App.scene.add(group);
    const record = {
      type: 'buzzer', group, pins, pinMeshes: [],
      holeRefs: [{ col: holeA.col, row: holeA.row },
                 { col: holeB.col, row: holeB.row }],
    };
    addPinMarkers(record);
    state.components.push(record);
    refreshCounts();
  };

  App.placeButton = function (holeA, holeB) {
    const { group, pins, capMesh } = App.buildButton(holeA, holeB);
    App.scene.add(group);
    const record = {
      type: 'button', group, pins, pinMeshes: [],
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
      const targetCol = comp.pressed ? 0x44cc44 : 0xe5e5e5;
      const targetEmi = comp.pressed ? 0x115511 : 0x000000;
      const targetEmiI = comp.pressed ? 0.6 : 0;

      // Kill any in-progress animation on this cap
      if (cap.userData._animId) cancelAnimationFrame(cap.userData._animId);

      const startY   = cap.position.y;
      const startCol = cap.material.color.getHex();
      const startEmi = cap.material.emissive.getHex();
      const startEmiI = cap.material.emissiveIntensity;
      const duration  = 80; // ms — snappy but visible
      const t0        = performance.now();

      const colA = new THREE.Color(startCol);
      const colB = new THREE.Color(targetCol);
      const emiA = new THREE.Color(startEmi);
      const emiB = new THREE.Color(targetEmi);

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

  // ── Save / Load ──────────────────────────────────────────────

  App.saveCircuit = function () {
    // Build a raw serializable state (cols/rows, not world coords)
    const data = {
      version: 1,
      components: state.components.map((c, i) => ({
        type:     c.type,
        id:       c.type + '_' + i,
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
        color:        w.group?.children?.[0]?.material?.color?.getHex?.() ?? state.wireColor,
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'circuit.sparky';
    a.click();
    URL.revokeObjectURL(url);
    App.setHint('Circuit saved as circuit.sparky', 2500);
  };

  // ── Internal: load a parsed circuit data object onto the board ─
  App.loadCircuitData = function (data) {
    App.clearAll();
    const bb = state.breadboard;

    // Rebuild components
    const rebuilt = [];
    for (const c of (data.components || [])) {
      if (c.type === 'resistor' && c.holeRefs?.length === 2) {
        const hA = bb.getHole(c.holeRefs[0].col, c.holeRefs[0].row);
        const hB = bb.getHole(c.holeRefs[1].col, c.holeRefs[1].row);
        if (hA && hB) App.placeResistor(hA, hB);
      } else if (c.type === 'led' && c.holeRefs?.length === 2) {
        const hA = bb.getHole(c.holeRefs[0].col, c.holeRefs[0].row);
        const hB = bb.getHole(c.holeRefs[1].col, c.holeRefs[1].row);
        if (hA && hB) App.placeLED(hA, hB);
      } else if (c.type === 'buzzer' && c.holeRefs?.length === 2) {
        const hA = bb.getHole(c.holeRefs[0].col, c.holeRefs[0].row);
        const hB = bb.getHole(c.holeRefs[1].col, c.holeRefs[1].row);
        if (hA && hB) App.placeBuzzer(hA, hB);
      } else if (c.type === 'button' && c.holeRefs?.length === 2) {
        const hA = bb.getHole(c.holeRefs[0].col, c.holeRefs[0].row);
        const hB = bb.getHole(c.holeRefs[1].col, c.holeRefs[1].row);
        if (hA && hB) App.placeButton(hA, hB);
      } else if (c.type === 'battery' && c.position) {
        App.placeBattery(c.position.x, c.position.z);
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
    App.setHint(`Loaded ${data.components?.length ?? 0} components, ${data.wires?.length ?? 0} wires`, 3000);
  };

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
      catch { App.setHint('⚠️ Invalid file', 2500); return; }
      App.loadCircuitData(data);
    };
    inp.click();
  };

  // ── Markdown Export (human-readable for AI) ──────────────────

  App.exportMarkdown = function () {
    function holeStr(ref) {
      if (!ref) return null;
      return ref.row + (ref.col + 1);  // e.g. "e14"
    }

    const comps = state.components;
    const wires = state.wires;

    // ── Summary line ──
    const isEmpty = !comps.length && !wires.length;
    let md = isEmpty
      ? '**Board status: EMPTY — no components or wires placed yet.**\n\n'
      : `**Board status: ${comps.length} component(s), ${wires.length} wire(s).**\n\n`;

    // ── Component table ──
    md += '## Components\n';
    if (!comps.length) {
      md += '_None._\n';
    } else {
      md += '| id | type | pin_A | pin_B |\n';
      md += '|----|------|-------|-------|\n';
      comps.forEach((c, i) => {
        const id = `${c.type}_${i}`;
        let pA = '—', pB = '—';
        if (c.holeRefs) {
          pA = holeStr(c.holeRefs[0]);
          pB = holeStr(c.holeRefs[1]);
          if (c.type === 'led') { pA += ' (cathode −)'; pB += ' (anode +)'; }
        } else {
          // Off-board battery — show the wire reference names the AI must use
          pA = `off-board + → wire ref: ${id}_pin0`;
          pB = `off-board − → wire ref: ${id}_pin1`;
        }
        md += `| ${id} | ${c.type} | ${pA} | ${pB} |\n`;
      });
    }

    // ── Battery wiring cheat-sheet ──
    const batteries = comps.filter(c => c.type === 'battery');
    if (batteries.length) {
      md += '\n## Battery wiring (how to connect in add_wire actions)\n';
      batteries.forEach((b, i) => {
        const id = `battery_${comps.indexOf(b)}`;
        md += `- **${id}**: positive terminal → use \`"from": "${id}_pin0"\`  |  negative terminal → use \`"from": "${id}_pin1"\`\n`;
      });
    }

    // ── Wire table ──
    md += '\n## Wires\n';
    if (!wires.length) {
      md += '_None._\n';
    } else {
      md += '| from | to | color |\n';
      md += '|------|----|-----------|\n';
      wires.forEach(w => {
        const from = w.startHole
          ? holeStr(w.startHole)
          : (w.startComp ? `${w.startComp.type}_${comps.indexOf(w.startComp)}_pin${w.startPinIdx}` : '?');
        const to = w.endHole
          ? holeStr(w.endHole)
          : (w.endComp ? `${w.endComp.type}_${comps.indexOf(w.endComp)}_pin${w.endPinIdx}` : '?');
        const colorHex = '#' + (w.group?.children?.[0]?.material?.color?.getHex?.() ?? 0xef4444).toString(16).padStart(6, '0');
        md += `| ${from} | ${to} | ${colorHex} |\n`;
      });
    }

    // ── Topology ──
    md += `
## Breadboard topology (always true)
- Columns 1–29. Holes a1–e1 share one node; f1–j1 share another node (center channel divides them).
- Same rule for every column: a-e connected together, f-j connected together.
- To connect top half (a-e) to bottom half (f-j) of the SAME column, you MUST add a wire.
- tp = positive top rail (+9V), tn = negative top rail (GND).
- bp = positive bottom rail (+9V), bn = negative bottom rail (GND).
- Rails are NOT connected to body rows — you must wire from rail to a body hole explicitly.
`;
    return md;
  };

  // ── Export State (for AI / save-load) ────────────────────────

  App.exportState = function () {
    function holeStr(ref) {
      if (!ref) return null;
      return ref.row + (ref.col + 1);   // e.g. "e14"
    }

    const components = state.components.map((c, i) => {
      const obj = { type: c.type.toUpperCase(), id: c.type + '_' + i };
      if (c.holeRefs) {
        obj.holes = c.holeRefs.map(holeStr);
      } else if (c.group) {
        obj.position = {
          x: +c.group.position.x.toFixed(2),
          z: +c.group.position.z.toFixed(2),
        };
      }
      if (c.type === 'led')      obj.color = 'red';
      if (c.type === 'resistor') obj.value = '330Ω';
      return obj;
    });

    const wires = state.wires.map(w => {
      const from = w.startHole
        ? holeStr(w.startHole)
        : (w.startComp ? w.startComp.type + '_pin' + w.startPinIdx : null);
      const to = w.endHole
        ? holeStr(w.endHole)
        : (w.endComp ? w.endComp.type + '_pin' + w.endPinIdx : null);
      return { from, to };
    });

    return { components, wires };
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

  // Auto-load circuit passed from dashboard via sessionStorage
  const _pending = sessionStorage.getItem('sparky_load_circuit');
  if (_pending) {
    sessionStorage.removeItem('sparky_load_circuit');
    try { App.loadCircuitData(JSON.parse(_pending)); } catch (e) { console.warn('Auto-load failed', e); }
  }

})(window.App = window.App || {});
