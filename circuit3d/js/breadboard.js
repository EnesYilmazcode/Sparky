// ─────────────────────────────────────────────────────────────
//  breadboard.js — Realistic 3D breadboard with hole grid
//
//  CONDUCTIVITY MODEL (matches real breadboards):
//
//  Body (middle):
//    • Holes in the SAME COLUMN within the SAME HALF are connected.
//    • Top half (rows a–e) in column 5 → all five holes are one node.
//    • Bottom half (rows f–j) in column 5 → separate node.
//    • The centre gap between e and f is a break — no connection.
//
//  Power rails (sides):
//    • All holes in the top (+) rail row → one node.
//    • All holes in the top (−) rail row → one node.
//    • Same for bottom rails.
//
//  Exports: App.createBreadboard()
// ─────────────────────────────────────────────────────────────

(function (App) {

  const COLS         = 50;
  const HS           = 0.40;   // hole spacing (world units)
  const BOARD_THICK  = 0.38;
  const MARGIN_X     = 0.90;

  // Z position of every row measured from board centre (0)
  const ROW_Z = {
    tp: -3.35,  tn: -2.95,                           // top rails
    a: -2.15, b: -1.75, c: -1.35, d: -0.95, e: -0.55,  // top body
    // ← centre channel gap (no holes) →
    f: +0.55, g: +0.95, h: +1.35, i: +1.75, j: +2.15,  // bottom body
    bn: +2.95,  bp: +3.35,                           // bottom rails
  };

  const ALL_ROWS  = ['tp','tn','a','b','c','d','e','f','g','h','i','j','bn','bp'];
  const BODY_ROWS = ['a','b','c','d','e','f','g','h','i','j'];
  const RAIL_ROWS = ['tp','tn','bn','bp'];

  const BOARD_W = (COLS - 1) * HS + 2 * MARGIN_X;  // ≈ 21.4
  const BOARD_D = 7.9;

  // Ordered body rows for rotation/span calculations
  const BODY_ROWS_ORDERED = ['a','b','c','d','e','f','g','h','i','j'];

  // ── Factory ─────────────────────────────────────────────────
  function createBreadboard() {
    const bbGroup  = new THREE.Group();
    bbGroup.name   = 'breadboard';
    const holeData = [];

    // ── 1. Body ──────────────────────────────────────────────
    const bodyGeo = new THREE.BoxGeometry(BOARD_W, BOARD_THICK, BOARD_D);
    const body    = new THREE.Mesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xf0ebe0 }));
    body.position.y = -BOARD_THICK / 2;
    body.receiveShadow = body.castShadow = true;
    body.name = 'bb-body';
    bbGroup.add(body);

    // Top face (slightly darker cream)
    const topFace = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W, BOARD_D),
      new THREE.MeshLambertMaterial({ color: 0xe8e2d0 })
    );
    topFace.rotation.x = -Math.PI / 2;
    topFace.position.y = 0.001;
    bbGroup.add(topFace);

    // ── 2. Power rail colour strips ──────────────────────────
    const railW = BOARD_W - 0.6;

    function addRailStrip(hexCol, z) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(railW, 0.01, 0.34),
        new THREE.MeshLambertMaterial({ color: hexCol, opacity: 0.8, transparent: true })
      );
      m.position.set(0, 0.003, z);
      bbGroup.add(m);
    }
    addRailStrip(0xee1111, ROW_Z.tp); // top  + (red)
    addRailStrip(0x1144dd, ROW_Z.tn); // top  − (blue)
    addRailStrip(0x1144dd, ROW_Z.bn); // bot  − (blue)
    addRailStrip(0xee1111, ROW_Z.bp); // bot  + (red)

    // ── 3. Rail +/− text labels (flat coloured strips with markers) ─
    // Small "+" and "−" indicator blocks at the left edge of each rail
    function addRailLabel(isPos, z) {
      const col = isPos ? 0xee1111 : 0x1144dd;
      const mat = new THREE.MeshLambertMaterial({ color: col });
      // Vertical bar of "+"
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.22), mat);
      v.position.set(-BOARD_W / 2 + 0.28, 0.005, z);
      bbGroup.add(v);
      // Horizontal bar of "+" or "−"
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.06), mat);
      h.position.set(-BOARD_W / 2 + 0.28, 0.005, z);
      bbGroup.add(h);
      if (!isPos) {
        // Remove vertical bar for "−" (just keep horizontal)
        v.visible = false;
      }
    }
    addRailLabel(true,  ROW_Z.tp);
    addRailLabel(false, ROW_Z.tn);
    addRailLabel(false, ROW_Z.bn);
    addRailLabel(true,  ROW_Z.bp);

    // ── 4. Centre channel ────────────────────────────────────
    const chan = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W - 0.4, 0.012, 0.62),
      new THREE.MeshLambertMaterial({ color: 0xb0a898 })
    );
    chan.position.set(0, 0.003, 0);
    bbGroup.add(chan);

    // ── 5. Subtle column-group shading every other column ────
    // Helps users see the vertical groupings
    for (let col = 0; col < COLS; col += 2) {
      const x = (col - (COLS - 1) / 2) * HS;
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(HS * 0.9, 0.006, 2.4),  // covers rows a-e or f-j
        new THREE.MeshLambertMaterial({ color: 0xddd7c4, transparent: true, opacity: 0.5 })
      );
      stripe.position.set(x, 0.002, -ROW_Z.a + (ROW_Z.e - ROW_Z.a) / 2);
      // top half
      const stripeT = stripe.clone();
      stripeT.position.z = (ROW_Z.a + ROW_Z.e) / 2;
      bbGroup.add(stripeT);
      // bottom half
      const stripeB = stripe.clone();
      stripeB.position.z = (ROW_Z.f + ROW_Z.j) / 2;
      bbGroup.add(stripeB);
    }

    // ── 6. Holes (InstancedMesh) ─────────────────────────────
    const totalHoles = COLS * ALL_ROWS.length;
    const holeGeo    = new THREE.CylinderGeometry(0.07, 0.07, BOARD_THICK + 0.06, 8);
    const holeMat    = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const holesMesh  = new THREE.InstancedMesh(holeGeo, holeMat, totalHoles);
    holesMesh.name   = 'bb-holes';

    const dummy = new THREE.Object3D();
    let idx = 0;

    ALL_ROWS.forEach(row => {
      const z = ROW_Z[row];
      for (let col = 0; col < COLS; col++) {
        const x = (col - (COLS - 1) / 2) * HS;
        dummy.position.set(x, 0, z);
        dummy.updateMatrix();
        holesMesh.setMatrixAt(idx, dummy.matrix);
        holeData.push({ idx, col, row, x, z, world: new THREE.Vector3(x, 0, z), occupied: false });
        idx++;
      }
    });

    holesMesh.instanceMatrix.needsUpdate = true;
    bbGroup.add(holesMesh);

    // ── 7. Edge trim ─────────────────────────────────────────
    const edgeTrim = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeo),
      new THREE.LineBasicMaterial({ color: 0xb8b0a0 })
    );
    edgeTrim.position.set(0, -BOARD_THICK / 2, 0);
    bbGroup.add(edgeTrim);

    // ── Helpers ───────────────────────────────────────────────

    function getNearestHole(wx, wz, onlyRows) {
      let best = null, bestD = Infinity;
      for (const h of holeData) {
        if (onlyRows && !onlyRows.includes(h.row)) continue;
        const d = (h.x - wx) ** 2 + (h.z - wz) ** 2;
        if (d < bestD) { bestD = d; best = h; }
      }
      return bestD < 1.8 ? best : null;
    }

    function getHole(col, row) {
      return holeData.find(h => h.col === col && h.row === row) ?? null;
    }

    // Given a starting hole and a span + rotation, return the second hole
    // rotation: 0 = horizontal (same row), 1 = vertical (same column)
    function getSpanHole(startHole, span, rotation) {
      if (rotation === 0) {
        // horizontal: same row, col + span
        return getHole(startHole.col + span, startHole.row);
      } else {
        // vertical: same col, move down through body rows
        const ri = BODY_ROWS_ORDERED.indexOf(startHole.row);
        if (ri < 0) return null;
        const newRow = BODY_ROWS_ORDERED[ri + span];
        return newRow ? getHole(startHole.col, newRow) : null;
      }
    }

    return {
      group: bbGroup,
      holesMesh,          // exposed for raycasting in interaction.js
      holeData,
      getNearestHole,
      getHole,
      getSpanHole,
      COLS, HS, ROW_Z,
      BOARD_W, BOARD_D,
      BODY_ROWS, RAIL_ROWS,
      BODY_ROWS_ORDERED,
    };
  }

  App.createBreadboard = createBreadboard;

})(window.App = window.App || {});
