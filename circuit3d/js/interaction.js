// ─────────────────────────────────────────────────────────────
//  interaction.js — Mouse events, raycasting, placement,
//                   selection, and wire drawing logic
//
//  Requires: App.scene, App.camera, App.controls, App.state
//  Exports:  App.initInteraction()
// ─────────────────────────────────────────────────────────────

(function (App) {

  function initInteraction() {
    const { scene, camera, controls, state } = App;
    const canvas    = document.getElementById('canvas');
    const holeLabel = document.getElementById('hole-label');

    // ── Raycasting helpers ──────────────────────────────────

    const raycaster = new THREE.Raycaster();
    const mouseNDC  = new THREE.Vector2();
    const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    function updateRay(e) {
      const r = canvas.getBoundingClientRect();
      mouseNDC.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
      mouseNDC.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, camera);
    }

    // Hit-test a list of meshes. Returns array of intersections.
    function hitTest(meshList) {
      return raycaster.intersectObjects(meshList, false);
    }

    // Get all meshes from placed components (for selection)
    function getComponentMeshes() {
      const meshes = [];
      state.components.forEach(c => {
        c.group.traverse(obj => { if (obj.isMesh) meshes.push(obj); });
      });
      return meshes;
    }

    // Get all pin indicator spheres (for wire mode)
    function getPinMeshes() {
      const meshes = [];
      state.components.forEach(c => {
        (c.pinMeshes || []).forEach(pm => meshes.push(pm));
      });
      return meshes;
    }

    // ── Drag detection ──────────────────────────────────────

    let mouseDownPos = null;
    let wasDragged   = false;

    canvas.addEventListener('mousedown', e => {
      mouseDownPos = { x: e.clientX, y: e.clientY };
      wasDragged = false;
    });

    canvas.addEventListener('mousemove', e => {
      if (mouseDownPos) {
        const dx = e.clientX - mouseDownPos.x;
        const dy = e.clientY - mouseDownPos.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragged = true;
      }
      handleHover(e);
    });

    canvas.addEventListener('mouseup', () => { mouseDownPos = null; });

    // ── Hover ───────────────────────────────────────────────

    // Glowing green sphere that shows the snapped hole target
    const hoverSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 12),
      new THREE.MeshLambertMaterial({ color: 0x22cc55, emissive: 0x115522, emissiveIntensity: 0.8 })
    );
    hoverSphere.visible = false;
    scene.add(hoverSphere);

    let lastHoveredHole = null;

    function handleHover(e) {
      const mode = state.mode;

      if (mode === 'place' && state.pickedType !== 'battery') {
        // Show snap indicator on nearest hole
        updateRay(e);
        const bbBody = scene.getObjectByName('bb-body');
        if (!bbBody) return;

        const hits = hitTest([bbBody]);
        if (hits.length) {
          const pt   = hits[0].point;
          const hole = state.breadboard.getNearestHole(pt.x, pt.z, null);
          if (hole) {
            hoverSphere.position.set(hole.x, 0.12, hole.z);
            hoverSphere.visible = true;
            lastHoveredHole = hole;

            holeLabel.style.display = 'block';
            holeLabel.textContent   = `Col ${hole.col + 1}  Row ${hole.row.toUpperCase()}`;
          } else {
            hoverSphere.visible = false;
            holeLabel.style.display = 'none';
          }
        } else {
          hoverSphere.visible = false;
          holeLabel.style.display = 'none';
        }

      } else if (mode === 'wire') {
        // Highlight nearest pin sphere
        updateRay(e);
        const pinMeshes = getPinMeshes();
        if (!pinMeshes.length) return;

        const hits = hitTest(pinMeshes);
        pinMeshes.forEach(pm => {
          pm.material.emissive.setHex(pm.userData.isWireStart ? 0x884400 : 0x2a2a00);
          pm.material.emissiveIntensity = pm.userData.isWireStart ? 1.0 : 0.4;
        });
        if (hits.length) {
          const pm = hits[0].object;
          pm.material.emissive.setHex(0x00aa44);
          pm.material.emissiveIntensity = 1.0;
        }

      } else {
        hoverSphere.visible = false;
        holeLabel.style.display = 'none';
      }
    }

    // ── Click ───────────────────────────────────────────────

    canvas.addEventListener('click', e => {
      if (wasDragged) return;
      updateRay(e);
      handleClick(e);
    });

    function handleClick(e) {
      const mode = state.mode;

      // ── PLACE mode ──────────────────────────────────────
      if (mode === 'place') {

        if (state.pickedType === 'battery') {
          // Place battery at a hit point on the ground/board plane
          const pt  = new THREE.Vector3();
          const hit = raycaster.ray.intersectPlane(boardPlane, pt);
          if (hit) App.placeBattery(pt.x, pt.z);
          return;
        }

        if (!lastHoveredHole) return;

        const col = lastHoveredHole.col;
        const row = lastHoveredHole.row;

        if (state.pickedType === 'resistor') App.placeResistor(col, row);
        if (state.pickedType === 'led')      App.placeLED(col, row);
        return;
      }

      // ── SELECT mode ─────────────────────────────────────
      if (mode === 'select') {
        const compMeshes = getComponentMeshes();
        const wireMeshes = state.wires.map(w => w.mesh);
        const all        = [...compMeshes, ...wireMeshes];

        if (!all.length) { App.deselect(); return; }

        const hits = hitTest(all);
        if (!hits.length) { App.deselect(); return; }

        const hitObj = hits[0].object;

        // Check wires first
        const hitWire = state.wires.find(w => w.mesh === hitObj);
        if (hitWire) { App.selectItem(hitWire, 'wire'); return; }

        // Walk up to find the owning placed component
        for (const comp of state.components) {
          let found = false;
          comp.group.traverse(obj => { if (obj === hitObj) found = true; });
          if (found) { App.selectItem(comp, 'component'); return; }
        }

        App.deselect();
        return;
      }

      // ── WIRE mode ───────────────────────────────────────
      if (mode === 'wire') {
        const pinMeshes = getPinMeshes();
        if (!pinMeshes.length) return;

        const hits = hitTest(pinMeshes);
        if (!hits.length) return;

        const pm   = hits[0].object;
        const comp = pm.userData.ownerComp;
        const pidx = pm.userData.pinIndex;

        if (!state.wireStart) {
          // Start wire from this pin
          state.wireStart = {
            world:    pm.userData.world.clone(),
            pinMesh:  pm,
            comp,
            pinIndex: pidx,
          };
          pm.userData.isWireStart = true;
          pm.material.emissive.setHex(0x884400);
          pm.material.emissiveIntensity = 1.0;
          App.setHint('Now click another pin to complete the wire · ESC to cancel');

        } else {
          // Prevent connecting a pin to itself or same component
          if (comp === state.wireStart.comp && pidx === state.wireStart.pinIndex) return;

          // Pass full pin descriptor so the simulator can trace connections
          App.finishWire({
            world:    pm.userData.world.clone(),
            comp:     pm.userData.ownerComp,
            pinIndex: pm.userData.pinIndex,
          });
        }
      }
    }

    // ── Keyboard ────────────────────────────────────────────

    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case 's': case 'S': App.setMode('select'); break;
        case 'p': case 'P': App.setMode('place');  break;
        case 'w': case 'W': App.setMode('wire');   break;
        case 'Escape':
          App.cancelWire();
          App.deselect();
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          App.deleteSelected();
          break;
      }
    });
  }

  App.initInteraction = initInteraction;

})(window.App = window.App || {});
