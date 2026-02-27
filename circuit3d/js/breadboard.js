// ─────────────────────────────────────────────────────────────
//  breadboard.js — Realistic 3D breadboard with hole grid
//
//  Hole grid layout (top-down view, Z goes front/back):
//    Top power rails: tp (+), tn (−)
//    Body rows:  a b c d e  [center gap]  f g h i j
//    Bottom power rails: bn (−), bp (+)
//
//  Exports: App.createBreadboard()
// ─────────────────────────────────────────────────────────────

(function (App) {

  // ── Breadboard dimensions ───────────────────────────────────
  const COLS          = 50;   // tie-point columns
  const HOLE_SPACING  = 0.40; // world units between holes
  const BOARD_THICK   = 0.38; // board height
  const MARGIN_X      = 0.9;  // side margin beyond outermost column

  // Z positions of each row (0 = board center)
  const ROW_Z = {
    tp: -3.35,   // top positive rail
    tn: -2.95,   // top negative rail
    a:  -2.15,
    b:  -1.75,
    c:  -1.35,
    d:  -0.95,
    e:  -0.55,
    // center channel gap  (± 0.35)
    f:  +0.55,
    g:  +0.95,
    h:  +1.35,
    i:  +1.75,
    j:  +2.15,
    bn: +2.95,   // bottom negative rail
    bp: +3.35,   // bottom positive rail
  };

  const RAIL_ROWS = ['tp','tn','bn','bp'];
  const BODY_ROWS = ['a','b','c','d','e','f','g','h','i','j'];
  const ALL_ROWS  = ['tp','tn','a','b','c','d','e','f','g','h','i','j','bn','bp'];

  // Derived board geometry
  const BOARD_W = (COLS - 1) * HOLE_SPACING + 2 * MARGIN_X; // ≈ 21.4
  const BOARD_D = 7.9;                                        // covers tp→bp + margin

  // ── Factory function ────────────────────────────────────────
  function createBreadboard() {

    const bbGroup  = new THREE.Group();
    const holeData = []; // { col, row, x, z, world, occupied }
    bbGroup.name = 'breadboard';

    // ── 1. Main cream body ────────────────────────────────────
    const bodyGeo = new THREE.BoxGeometry(BOARD_W, BOARD_THICK, BOARD_D);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xf0ebe0 });
    const body    = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = -BOARD_THICK / 2;
    body.receiveShadow = true;
    body.castShadow    = true;
    body.name = 'bb-body';
    bbGroup.add(body);

    // ── 2. Subtle top surface tint (slightly darker cream) ────
    const topGeo = new THREE.PlaneGeometry(BOARD_W, BOARD_D);
    const topMat = new THREE.MeshLambertMaterial({ color: 0xeae4d4 });
    const topFace = new THREE.Mesh(topGeo, topMat);
    topFace.rotation.x = -Math.PI / 2;
    topFace.position.y = 0.001;
    topFace.receiveShadow = true;
    bbGroup.add(topFace);

    // ── 3. Power rail color strips ────────────────────────────
    const railStripW = BOARD_W - 0.6;

    function addRailStrip(hexColor, z) {
      const geo  = new THREE.BoxGeometry(railStripW, 0.01, 0.34);
      const mat  = new THREE.MeshLambertMaterial({ color: hexColor, opacity: 0.75, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0.003, z);
      bbGroup.add(mesh);
    }

    addRailStrip(0xee2222, ROW_Z.tp); // top positive — red
    addRailStrip(0x1155dd, ROW_Z.tn); // top negative — blue
    addRailStrip(0x1155dd, ROW_Z.bn); // bottom negative — blue
    addRailStrip(0xee2222, ROW_Z.bp); // bottom positive — red

    // ── 4. Center channel (darker strip between e and f) ──────
    const chanGeo = new THREE.BoxGeometry(BOARD_W - 0.4, 0.012, 0.65);
    const chanMat = new THREE.MeshLambertMaterial({ color: 0xb0a898 });
    const chan    = new THREE.Mesh(chanGeo, chanMat);
    chan.position.set(0, 0.003, 0); // centered between e (−0.55) and f (+0.55)
    bbGroup.add(chan);

    // ── 5. Row label tick marks (silkscreen lines) ────────────
    // Small white tick lines between the rail and the body holes
    function addTickMark(z, label) {
      const geo = new THREE.BoxGeometry(0.04, 0.008, 0.24);
      const mat = new THREE.MeshLambertMaterial({ color: 0xc8bfae });
      for (let side of [-1, 1]) {
        const tick = new THREE.Mesh(geo, mat);
        tick.position.set(side * (BOARD_W / 2 - 0.18), 0.005, z);
        bbGroup.add(tick);
      }
    }
    BODY_ROWS.forEach(row => addTickMark(ROW_Z[row], row));

    // ── 6. Holes as InstancedMesh ─────────────────────────────
    const totalHoles = COLS * ALL_ROWS.length;
    const holeRadius = 0.07;
    const holeGeo    = new THREE.CylinderGeometry(holeRadius, holeRadius, BOARD_THICK + 0.06, 8);
    const holeMat    = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const holesMesh  = new THREE.InstancedMesh(holeGeo, holeMat, totalHoles);
    holesMesh.name = 'bb-holes';

    const dummy = new THREE.Object3D();
    let idx = 0;

    ALL_ROWS.forEach(row => {
      const z = ROW_Z[row];
      for (let col = 0; col < COLS; col++) {
        const x = (col - (COLS - 1) / 2) * HOLE_SPACING;
        dummy.position.set(x, 0, z);
        dummy.updateMatrix();
        holesMesh.setMatrixAt(idx, dummy.matrix);

        holeData.push({
          idx, col, row,
          x, z,
          world: new THREE.Vector3(x, 0, z),
          occupied: false,
        });
        idx++;
      }
    });

    holesMesh.instanceMatrix.needsUpdate = true;
    bbGroup.add(holesMesh);

    // ── 7. Board edge trim ────────────────────────────────────
    const edgeMat  = new THREE.LineBasicMaterial({ color: 0xb8b0a0 });
    const edgeGeo  = new THREE.EdgesGeometry(bodyGeo);
    const edgeLine = new THREE.LineSegments(edgeGeo, edgeMat);
    edgeLine.position.y = -BOARD_THICK / 2;
    bbGroup.add(edgeLine);

    // ── Helpers ───────────────────────────────────────────────

    /**
     * Given a world-space x/z point on the board surface,
     * return the nearest hole data object (or null if too far).
     */
    function getNearestHole(wx, wz, onlyRows) {
      let best = null;
      let bestDist = Infinity;
      for (const h of holeData) {
        if (onlyRows && !onlyRows.includes(h.row)) continue;
        const dx = h.x - wx;
        const dz = h.z - wz;
        const d  = dx * dx + dz * dz;
        if (d < bestDist) { bestDist = d; best = h; }
      }
      // Only snap if within a reasonable range
      return bestDist < 1.5 ? best : null;
    }

    /**
     * Returns the hole at a specific (col, row).
     */
    function getHole(col, row) {
      return holeData.find(h => h.col === col && h.row === row) || null;
    }

    return {
      group: bbGroup,
      holeData,
      getNearestHole,
      getHole,
      COLS,
      HOLE_SPACING,
      ROW_Z,
      BODY_ROWS,
      BOARD_W,
      BOARD_D,
    };
  }

  // ── Exports ────────────────────────────────────────────────
  App.createBreadboard = createBreadboard;

})(window.App = window.App || {});
