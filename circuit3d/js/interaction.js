// ─────────────────────────────────────────────────────────────
//  interaction.js — Mouse events, raycasting, ghost preview,
//                   rotation, hole-based wire placement
//
//  KEY BEHAVIOURS
//  • Place mode: hover shows a transparent ghost; click places component.
//    R key rotates the ghost 90°.
//  • Wire mode:  click any breadboard HOLE or component pin sphere to start
//    a wire; click again to complete it.  The wire plugs into both holes.
//  • Select mode: click a component body or wire tube to select it.
// ─────────────────────────────────────────────────────────────

(function (App) {

  function initInteraction() {
    const { scene, camera, controls, state } = App;
    const canvas    = document.getElementById('canvas');
    const holeLabel = document.getElementById('hole-label');

    // ── Raycasting ──────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouseNDC  = new THREE.Vector2();
    const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    function updateRay(e) {
      const r   = canvas.getBoundingClientRect();
      mouseNDC.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
      mouseNDC.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, camera);
    }

    function getAllComponentMeshes() {
      const out = [];
      state.components.forEach(c => c.group.traverse(o => { if (o.isMesh) out.push(o); }));
      return out;
    }

    function getAllPinMeshes() {
      const out = [];
      state.components.forEach(c => (c.pinMeshes || []).forEach(pm => out.push(pm)));
      return out;
    }

    // ── Ghost management ─────────────────────────────────────
    // The ghost preview group, recreated when type or rotation changes.
    let ghostGroup   = null;
    let ghostType    = null;
    let ghostRot     = null;  // 0 or 1

    function syncGhost() {
      const t = state.pickedType;
      const r = state.placementRotation;
      if (state.mode !== 'place' || !t) {
        destroyGhost();
        return;
      }
      if (ghostGroup && ghostType === t && ghostRot === r) return; // already built

      destroyGhost();
      const bb   = state.breadboard;
      const span = t === 'led' ? App.LED_SPAN : (t === 'resistor' ? App.RESISTOR_SPAN : 0);
      ghostGroup = App.buildPreview(t, span, bb.HS, r);
      ghostGroup.visible = false;
      scene.add(ghostGroup);
      ghostType = t;
      ghostRot  = r;
    }

    function destroyGhost() {
      if (ghostGroup) { scene.remove(ghostGroup); ghostGroup = null; }
      ghostType = ghostRot = null;
    }

    function positionGhost(holeA, holeB) {
      if (!ghostGroup || !holeA) { if (ghostGroup) ghostGroup.visible = false; return; }
      if (!holeB) { ghostGroup.visible = false; return; }

      const midX = (holeA.x + holeB.x) / 2;
      const midZ = (holeA.z + holeB.z) / 2;
      ghostGroup.position.set(midX, 0, midZ);
      ghostGroup.visible = true;
    }

    // ── Drag detection ──────────────────────────────────────
    let mouseDownPos = null;
    let wasDragged   = false;

    canvas.addEventListener('mousedown', e => {
      mouseDownPos = { x: e.clientX, y: e.clientY };
      wasDragged   = false;
    });
    canvas.addEventListener('mouseup', () => { mouseDownPos = null; });

    // ── Hover indicator sphere (shows snapped hole) ─────────
    const hoverSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 12),
      new THREE.MeshLambertMaterial({ color: 0x22cc55, emissive: 0x115522, emissiveIntensity: 0.9 })
    );
    hoverSphere.visible = false;
    scene.add(hoverSphere);

    // Highlighted wire-start pin (stored so we can reset it)
    let wireStartPinMesh = null;

    // ── mousemove ───────────────────────────────────────────
    canvas.addEventListener('mousemove', e => {
      if (mouseDownPos) {
        const dx = e.clientX - mouseDownPos.x;
        const dy = e.clientY - mouseDownPos.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragged = true;
      }
      handleHover(e);
    });

    function handleHover(e) {
      const mode = state.mode;
      updateRay(e);

      // ── PLACE mode ──────────────────────────────────────
      if (mode === 'place') {
        syncGhost();
        const type = state.pickedType;

        if (type === 'battery') {
          hoverSphere.visible     = false;
          holeLabel.style.display = 'none';
          // Position ghost at cursor, clamped outside the board
          const pt  = new THREE.Vector3();
          const hit = raycaster.ray.intersectPlane(boardPlane, pt);
          if (hit && ghostGroup) {
            const margin  = state.breadboard.BOARD_W / 2 + 2.5;
            const clampX  = pt.x >= 0 ? Math.max(pt.x, margin) : Math.min(pt.x, -margin);
            ghostGroup.position.set(clampX, 0, pt.z);
            ghostGroup.visible = true;
          } else if (ghostGroup) {
            ghostGroup.visible = false;
          }
          return;
        }

        // Raycast against board body
        const bbBody = scene.getObjectByName('bb-body');
        if (!bbBody) return;
        const hits = raycaster.intersectObject(bbBody, false);

        if (!hits.length) {
          hoverSphere.visible = false;
          holeLabel.style.display = 'none';
          if (ghostGroup) ghostGroup.visible = false;
          return;
        }

        const pt    = hits[0].point;
        const holeA = state.breadboard.getNearestHole(pt.x, pt.z, null);

        if (!holeA) {
          hoverSphere.visible = false;
          holeLabel.style.display = 'none';
          if (ghostGroup) ghostGroup.visible = false;
          return;
        }

        const span  = type === 'led' ? App.LED_SPAN : App.RESISTOR_SPAN;
        const holeB = state.breadboard.getSpanHole(holeA, span, state.placementRotation);

        // Update hover sphere on holeA
        hoverSphere.position.set(holeA.x, 0.12, holeA.z);
        hoverSphere.visible = true;

        // Update ghost
        syncGhost();
        positionGhost(holeA, holeB);
        if (ghostGroup) {
          ghostGroup.rotation.y = state.placementRotation === 1 ? Math.PI / 2 : 0;
        }

        // Hole label
        holeLabel.style.display = 'block';
        holeLabel.textContent   = `Col ${holeA.col + 1}  Row ${holeA.row.toUpperCase()}` +
          (holeB ? `  →  Col ${holeB.col + 1}  Row ${holeB.row.toUpperCase()}` : '  (no room)');

        // Store for click
        state._hoverHoleA = holeA;
        state._hoverHoleB = holeB;
        return;
      }

      // ── WIRE mode ───────────────────────────────────────
      if (mode === 'wire') {
        destroyGhost();
        hoverSphere.visible = false;
        holeLabel.style.display = 'none';

        // Highlight nearest hole (breadboard InstancedMesh)
        const { holesMesh, holeData } = state.breadboard;
        const holeHits = raycaster.intersectObject(holesMesh, false);
        const pinHits  = raycaster.intersectObjects(getAllPinMeshes(), false);

        // Reset all pin emissives
        getAllPinMeshes().forEach(pm => {
          if (pm === wireStartPinMesh) return;
          pm.material.emissive.setHex(0x3a2800);
          pm.material.emissiveIntensity = 0.4;
        });

        // Highlight hovered hole or pin
        if (pinHits.length) {
          const pm = pinHits[0].object;
          if (pm !== wireStartPinMesh) {
            pm.material.emissive.setHex(0x00aa44);
            pm.material.emissiveIntensity = 1.0;
          }
          hoverSphere.position.copy(pm.userData.world);
          hoverSphere.position.y += 0.06;
          hoverSphere.visible = true;
        } else if (holeHits.length) {
          const h = holeData[holeHits[0].instanceId];
          if (h) {
            hoverSphere.position.set(h.x, 0.12, h.z);
            hoverSphere.visible = true;
            holeLabel.style.display = 'block';
            holeLabel.textContent   = `Col ${h.col + 1}  Row ${h.row.toUpperCase()}`;
          }
        }

        // Update temp-wire preview
        updateTempWire(e);
        return;
      }

      // ── SELECT mode ─────────────────────────────────────
      destroyGhost();
      hoverSphere.visible = false;
      holeLabel.style.display = 'none';
    }

    // ── Temp wire preview line (while mid-draw) ─────────────
    function updateTempWire(e) {
      if (!state.wireStart) {
        if (state.tempWire) { scene.remove(state.tempWire); state.tempWire = null; }
        return;
      }
      if (state.tempWire) scene.remove(state.tempWire);

      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(boardPlane, target);
      if (!target) return;

      const pts = [state.wireStart.world, target];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({ color: 0x22cc55, dashSize: 0.3, gapSize: 0.15 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      scene.add(line);
      state.tempWire = line;
    }

    // ── click ────────────────────────────────────────────────
    canvas.addEventListener('click', e => {
      if (wasDragged) return;
      updateRay(e);
      handleClick(e);
    });

    function handleClick(e) {
      const mode = state.mode;

      // ── PLACE ──────────────────────────────────────────
      if (mode === 'place') {
        const type = state.pickedType;

        if (type === 'battery') {
          const pt  = new THREE.Vector3();
          const hit = raycaster.ray.intersectPlane(boardPlane, pt);
          if (hit) App.placeBattery(pt.x, pt.z);
          return;
        }

        const hA = state._hoverHoleA;
        const hB = state._hoverHoleB;
        if (!hA || !hB) return;

        if (type === 'resistor') App.placeResistor(hA, hB);
        if (type === 'led')      App.placeLED(hA, hB);
        return;
      }

      // ── SELECT ─────────────────────────────────────────
      if (mode === 'select') {
        const compMeshes = getAllComponentMeshes();
        const wireMeshes = state.wires.map(w => w.group).filter(Boolean)
          .concat(state.wires.map(w => w.tube).filter(Boolean));

        // also allow clicking wire tubes (stored as group children)
        const allWireMeshes = [];
        state.wires.forEach(w => {
          if (w.group) w.group.traverse(o => { if (o.isMesh) allWireMeshes.push(o); });
        });

        const all  = [...compMeshes, ...allWireMeshes];
        if (!all.length) { App.deselect(); return; }

        const hits = raycaster.intersectObjects(all, false);
        if (!hits.length) { App.deselect(); return; }

        const hitObj = hits[0].object;

        // Is it a wire?
        for (const w of state.wires) {
          let found = false;
          if (w.group) w.group.traverse(o => { if (o === hitObj) found = true; });
          if (found) { App.selectItem(w, 'wire'); return; }
        }

        // Walk up to find owning component group
        for (const comp of state.components) {
          let found = false;
          comp.group.traverse(o => { if (o === hitObj) found = true; });
          if (found) { App.selectItem(comp, 'component'); return; }
        }

        App.deselect();
        return;
      }

      // ── WIRE ───────────────────────────────────────────
      if (mode === 'wire') {
        // Resolve click target: prefer pin sphere, then hole
        const pinHits  = raycaster.intersectObjects(getAllPinMeshes(), false);
        const { holesMesh, holeData } = state.breadboard;
        const holeHits = raycaster.intersectObject(holesMesh, false);

        let clickHoleRef  = null;  // { col, row }
        let clickWorld    = null;  // Vector3
        let clickPinMesh  = null;

        if (pinHits.length) {
          const pm = pinHits[0].object;
          // Map pin back to its breadboard hole ref via ownerComp.holeRefs
          const comp    = pm.userData.ownerComp;
          const pidx    = pm.userData.pinIndex;
          const hRef    = comp?.holeRefs?.[pidx];
          clickHoleRef  = hRef || null;
          clickWorld    = pm.userData.world.clone();
          clickPinMesh  = pm;
        } else if (holeHits.length) {
          const h = holeData[holeHits[0].instanceId];
          if (h) { clickHoleRef = { col: h.col, row: h.row }; clickWorld = h.world.clone(); }
        }

        if (!clickWorld) return;

        if (!state.wireStart) {
          // Start wire
          state.wireStart = { world: clickWorld, holeRef: clickHoleRef, pinMesh: clickPinMesh };
          wireStartPinMesh = clickPinMesh;
          if (clickPinMesh) {
            clickPinMesh.userData.isWireStart = true;
            clickPinMesh.material.emissive.setHex(0x884400);
            clickPinMesh.material.emissiveIntensity = 1.1;
          }
          App.setHint('Click another hole or pin to complete the wire · ESC to cancel');
        } else {
          // Complete wire — pass pinMesh so simulate.js can resolve component pins
          App.finishWire({ world: clickWorld, holeRef: clickHoleRef, pinMesh: clickPinMesh });
          wireStartPinMesh = null;
        }
      }
    }

    // ── Keyboard ─────────────────────────────────────────────
    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'r' || e.key === 'R') {
        // Toggle rotation (0 ↔ 1)
        state.placementRotation = state.placementRotation === 0 ? 1 : 0;
        // Force ghost rebuild
        ghostType = null;
        syncGhost();
        App.setHint(`Rotation: ${state.placementRotation === 0 ? 'Horizontal' : 'Vertical'} · R to rotate`, 1800);
        return;
      }

      switch (e.key) {
        case 's': case 'S': App.setMode('select'); break;
        case 'p': case 'P': App.setMode('place');  break;
        case 'w': case 'W': App.setMode('wire');   break;
        case 'Escape':
          App.cancelWire();
          App.deselect();
          destroyGhost();
          wireStartPinMesh = null;
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          App.deleteSelected();
          break;
      }
    });

    // Clean up ghost when mode changes
    const _origSetMode = App.setMode.bind(App);
    App.setMode = function (m) {
      _origSetMode(m);
      if (m !== 'place') destroyGhost();
      hoverSphere.visible = false;
      holeLabel.style.display = 'none';
      wireStartPinMesh = null;
    };
  }

  App.initInteraction = initInteraction;

})(window.App = window.App || {});
