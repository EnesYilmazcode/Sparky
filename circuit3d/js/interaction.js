// ─────────────────────────────────────────────────────────────
//  interaction.js — Pointer events, raycasting, ghost preview,
//                   rotation, hole-based wire placement
//
//  KEY BEHAVIOURS
//  • Place mode: hover shows a ghost of the real part at the real holes,
//    blue if it fits and red if a hole is taken. Click places it.
//    R rotates between lying along a row and standing along a column.
//  • Wire mode: click a hole or a battery terminal to start, click again
//    to finish. A click on a hole that already holds a lead lands in the
//    nearest free hole of the same strip, which is the same connection.
//  • Select mode: click a part or a wire to select it.
// ─────────────────────────────────────────────────────────────

(function (App) {

  function initInteraction() {
    const { scene, camera, state } = App;
    const canvas    = document.getElementById('canvas');
    const holeLabel = document.getElementById('hole-label');

    // ── Raycasting ──────────────────────────────────────────
    const raycaster  = new THREE.Raycaster();
    const mouseNDC   = new THREE.Vector2();
    const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let   lastEvent  = null;

    function updateRay(e) {
      const r = canvas.getBoundingClientRect();
      mouseNDC.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
      mouseNDC.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, camera);
    }

    function boardPoint() {
      const p = new THREE.Vector3();
      return raycaster.ray.intersectPlane(boardPlane, p) ? p : null;
    }

    function holeUnderRay() {
      const p = boardPoint();
      if (!p) return null;
      const bb = state.breadboard;
      if (Math.abs(p.x) > bb.BOARD_W / 2 + 0.2 || Math.abs(p.z) > bb.BOARD_D / 2 + 0.2) return null;
      return bb.getNearestHole(p.x, p.z, null);
    }

    function getAllPinMeshes() {
      const out = [];
      state.components.forEach(c => (c.pinMeshes || []).forEach(pm => out.push(pm)));
      return out;
    }

    // ── Hover markers: flat rings on target holes ────────────
    function ring(color) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.12, 0.19, 40),
        new THREE.MeshBasicMaterial({ color: App.lin(color), transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 3;
      m.visible = false;
      scene.add(m);
      return m;
    }
    const GOOD = 0x22c55e, BAD = 0xef4444, PIN = 0xf59e0b;
    const markA = ring(GOOD), markB = ring(GOOD);

    function mark(m, hole, color, y) {
      if (!hole) { m.visible = false; return; }
      m.material.color.copy(App.lin(color));
      m.position.set(hole.x, y == null ? 0.012 : y, hole.z);
      m.visible = true;
    }

    App.addTicker(t => {
      const s = 1 + Math.sin(t * 6) * 0.08;
      markA.scale.set(s, s, 1);
      markB.scale.set(s, s, 1);
    });

    function hideHover() {
      markA.visible = markB.visible = false;
      holeLabel.style.display = 'none';
    }

    // ── Ghost of the part being placed ──────────────────────
    let ghost = null, ghostKey = '';

    function setGhost(type, holeA, holeB, ok) {
      const key = type + '|' + (holeA ? holeA.idx : 'x') + '|' + (holeB ? holeB.idx : 'x') + '|' + ok;
      if (key === ghostKey) return;
      clearGhost();
      ghostKey = key;
      if (!holeA || !holeB) return;
      ghost = App.buildPreview(type, holeA, holeB, ok);
      if (ghost) scene.add(ghost);
    }

    function clearGhost() {
      if (ghost) { scene.remove(ghost); App.disposeGroup(ghost); }
      ghost = null;
      ghostKey = '';
    }

    let batteryGhost = null;
    function showBatteryGhost(x, z) {
      if (!batteryGhost) {
        batteryGhost = App.buildPreview('battery', null, null, true);
        scene.add(batteryGhost);
      }
      batteryGhost.position.set(x, 0, z);
      batteryGhost.visible = true;
    }
    function hideBatteryGhost() { if (batteryGhost) batteryGhost.visible = false; }

    const SPANS = () => ({ led: App.LED_SPAN, resistor: App.RESISTOR_SPAN, buzzer: App.BUZZER_SPAN, button: App.BUTTON_SPAN });

    // Holes a part would use from the hovered anchor, and whether it fits.
    function footprint(type) {
      const holeA = holeUnderRay();
      if (!holeA) return null;
      const span  = SPANS()[type] || App.RESISTOR_SPAN;
      const holeB = state.breadboard.getSpanHole(holeA, span, state.placementRotation);
      const inRails = h => h && state.breadboard.RAIL_ROWS.includes(h.row);
      let ok = !!holeB && !inRails(holeA) && !inRails(holeB) &&
               App.isHoleFree(holeA) && App.isHoleFree(holeB);
      let why = '';
      if (!holeB) why = 'no room';
      else if (inRails(holeA) || inRails(holeB)) why = 'parts go in rows a to j';
      else if (!ok) why = 'a hole is taken';
      else if (App.overlapsPart(type, holeA, holeB)) { ok = false; why = 'it would sit on another part'; }
      return { holeA, holeB, ok, why };
    }

    // ── Drag detection ──────────────────────────────────────
    //  Pointer events cover mouse, touch and pen. OrbitControls calls
    //  preventDefault() on pointerdown, so a click is a pointerup that
    //  did not travel.
    let downPos = null, downPointerId = null, wasDragged = false;
    const DRAG_THRESH = 8;

    canvas.addEventListener('pointerdown', e => {
      if (!e.isPrimary || e.button !== 0) return;
      downPointerId = e.pointerId;
      downPos       = { x: e.clientX, y: e.clientY };
      wasDragged    = false;
    });

    canvas.addEventListener('pointercancel', e => {
      if (e.pointerId !== downPointerId) return;
      downPointerId = null;
      downPos       = null;
    });

    canvas.addEventListener('pointermove', e => {
      if (downPos && e.pointerId === downPointerId) {
        const dx = e.clientX - downPos.x, dy = e.clientY - downPos.y;
        if (dx * dx + dy * dy > DRAG_THRESH * DRAG_THRESH) wasDragged = true;
      }
      lastEvent = e;
      handleHover(e);
    });

    canvas.addEventListener('pointerleave', () => {
      hideHover();
      clearGhost();
      hideBatteryGhost();
    });

    function label(text) {
      holeLabel.style.display = 'block';
      holeLabel.textContent = text;
    }

    // ── Wire targets ─────────────────────────────────────────
    //  A hole, moved to a free neighbour on its strip when taken, or a
    //  battery terminal.
    function wireTarget() {
      const pinHits = raycaster.intersectObjects(getAllPinMeshes(), false);
      if (pinHits.length) {
        const pm = pinHits[0].object;
        return { world: pm.userData.world.clone(), holeRef: null, pinMesh: pm, pin: true };
      }
      const hole = holeUnderRay();
      if (!hole) return null;
      const free = App.isHoleFree(hole) ? hole : App.freeHoleOnStrip(hole);
      if (!free) return { hole, full: true };
      return { world: free.world.clone(), holeRef: { col: free.col, row: free.row }, pinMesh: null,
               hole: free, movedFrom: free === hole ? null : hole };
    }

    // ── Hover ────────────────────────────────────────────────
    function handleHover(e) {
      updateRay(e);
      const mode = state.mode;

      if (mode === 'place') {
        const type = state.pickedType;
        if (type === 'battery') {
          hideHover();
          clearGhost();
          const p = boardPoint();
          if (!p) { hideBatteryGhost(); return; }
          const margin = state.breadboard.BOARD_W / 2 + 2.2;
          showBatteryGhost(p.x >= 0 ? Math.max(p.x, margin) : Math.min(p.x, -margin), p.z);
          return;
        }
        hideBatteryGhost();
        const fp = footprint(type);
        if (!fp) { hideHover(); clearGhost(); return; }
        const color = fp.ok ? GOOD : BAD;
        mark(markA, fp.holeA, color);
        mark(markB, fp.holeB, color);
        setGhost(type, fp.holeA, fp.holeB, fp.ok);
        const a = App.formatHole(fp.holeA);
        label(fp.holeB ? `${a} → ${App.formatHole(fp.holeB)}${fp.ok ? '' : '  ·  ' + fp.why}` : `${a}  ·  no room`);
        return;
      }

      if (mode === 'wire') {
        clearGhost();
        hideBatteryGhost();
        const t = wireTarget();
        markB.visible = false;
        if (!t) { hideHover(); updateTempWire(null); return; }
        if (t.full) {
          mark(markA, t.hole, BAD);
          label(`${App.formatHole(t.hole)}  ·  this strip is full`);
          updateTempWire(null);
          return;
        }
        if (t.pin) {
          mark(markA, { x: t.world.x, z: t.world.z }, PIN, t.world.y + 0.01);
          label(t.pinMesh.userData.pinIndex === 0 ? 'battery +' : 'battery −');
        } else {
          mark(markA, t.hole, GOOD);
          label(t.movedFrom
            ? `${App.formatHole(t.hole)}  ·  ${App.formatHole(t.movedFrom)} is taken, same strip`
            : App.formatHole(t.hole));
        }
        updateTempWire(t);
        return;
      }

      clearGhost();
      hideBatteryGhost();
      hideHover();
    }

    // ── Live wire preview while drawing ──────────────────────
    const tempMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, transparent: true, opacity: 0.55, depthWrite: false });
    let tempKey = '';
    function updateTempWire(t) {
      if (!state.wireStart || !t || t.full) {
        if (state.tempWire) { scene.remove(state.tempWire); App.disposeGroup(state.tempWire); state.tempWire = null; tempKey = ''; }
        return;
      }
      const key = t.world.toArray().map(v => v.toFixed(2)).join(',');
      if (key === tempKey) return;
      if (state.tempWire) { scene.remove(state.tempWire); App.disposeGroup(state.tempWire); }
      tempMat.color.copy(App.lin(state.wireColor));
      state.tempWire = App.buildWire(state.wireStart.world, t.world, state.wireColor, { material: tempMat });
      scene.add(state.tempWire);
      tempKey = key;
    }

    // ── Click ────────────────────────────────────────────────
    canvas.addEventListener('pointerup', e => {
      if (e.pointerId !== downPointerId) return;
      if (downPos) {
        const dx = e.clientX - downPos.x, dy = e.clientY - downPos.y;
        if (dx * dx + dy * dy > DRAG_THRESH * DRAG_THRESH) wasDragged = true;
      }
      downPointerId = null;
      downPos       = null;
      if (wasDragged) return;
      updateRay(e);
      handleClick(e);
    });

    function handleClick(e) {
      const mode = state.mode;

      if (mode === 'place') {
        const type = state.pickedType;
        if (type === 'battery') {
          const p = boardPoint();
          if (p) App.placeBattery(p.x, p.z);
          return;
        }
        const fp = footprint(type);
        if (!fp || !fp.holeB) return;
        if (!fp.ok) { App.setHint(`Can't place here: ${fp.why}. Each hole holds one lead.`, 2400); return; }
        if (type === 'resistor') App.placeResistor(fp.holeA, fp.holeB);
        if (type === 'led')      App.placeLED(fp.holeA, fp.holeB);
        if (type === 'buzzer')   App.placeBuzzer(fp.holeA, fp.holeB);
        if (type === 'button')   App.placeButton(fp.holeA, fp.holeB);
        clearGhost();
        handleHover(e);
        return;
      }

      if (mode === 'select') {
        const meshes = [];
        state.components.forEach(c => c.group.traverse(o => { if (o.isMesh) meshes.push(o); }));
        state.wires.forEach(w => w.group && w.group.traverse(o => { if (o.isMesh) meshes.push(o); }));
        const hits = raycaster.intersectObjects(meshes, false);
        if (!hits.length) { App.deselect(); return; }
        const hit = hits[0].object;
        const owns = g => { let f = false; g.traverse(o => { if (o === hit) f = true; }); return f; };
        const w = state.wires.find(w => w.group && owns(w.group));
        if (w) { App.selectItem(w, 'wire'); return; }
        const c = state.components.find(c => owns(c.group));
        if (c) { App.selectItem(c, 'component'); return; }
        App.deselect();
        return;
      }

      if (mode === 'wire') {
        const t = wireTarget();
        if (!t || t.full) return;
        const end = { world: t.world, holeRef: t.holeRef, pinMesh: t.pinMesh };
        if (!state.wireStart) {
          state.wireStart = end;
          if (t.pinMesh) t.pinMesh.userData.isWireStart = true;
          App.setHint('Click another hole or a battery terminal to finish the wire · ESC to cancel');
        } else {
          const s = state.wireStart;
          const same = (s.holeRef && end.holeRef && s.holeRef.col === end.holeRef.col && s.holeRef.row === end.holeRef.row) ||
                       (s.pinMesh && s.pinMesh === end.pinMesh);
          if (same) return;
          App.finishWire(end);
        }
        updateTempWire(null);
        if (lastEvent) handleHover(lastEvent);
      }
    }

    // ── Keyboard ─────────────────────────────────────────────
    document.addEventListener('keydown', e => {
      const el = document.activeElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) App.redo(); else App.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;

      if (e.key === 'r' || e.key === 'R') {
        state.placementRotation = state.placementRotation === 0 ? 1 : 0;
        clearGhost();
        if (lastEvent) handleHover(lastEvent);
        App.setHint(`Rotation: ${state.placementRotation === 0 ? 'along a row' : 'along a column'} · R to rotate`, 1800);
        return;
      }

      switch (e.key) {
        case 's': case 'S': App.setMode('select'); break;
        case 'p': case 'P': App.setMode('place');  break;
        case 'w': case 'W': App.setMode('wire');   break;
        case 'Escape':
          App.setMode('select');
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          App.deleteSelected();
          break;
      }
    });

    // ── Clear All guard ──────────────────────────────────────
    document.addEventListener('click', e => {
      if (!e.target.closest?.('#clear-all-btn')) return;
      const n = state.components.length + state.wires.length;
      if (!n) return;
      if (!confirm(`Delete all ${n} item${n === 1 ? '' : 's'} on the board? You can undo this with Ctrl+Z.`)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // Tidy up the hover state whenever the mode changes
    const _origSetMode = App.setMode.bind(App);
    App.setMode = function (m) {
      _origSetMode(m);
      if (m !== 'place') { clearGhost(); hideBatteryGhost(); }
      updateTempWire(null);
      hideHover();
    };
  }

  App.initInteraction = initInteraction;

})(window.App = window.App || {});
