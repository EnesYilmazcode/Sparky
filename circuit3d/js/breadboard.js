// ─────────────────────────────────────────────────────────────
//  breadboard.js — Realistic 3D breadboard
//
//  Rail polarity (+ − + − reading near-viewer → far-viewer):
//    tp = + (red)   tn = − (blue)
//    bn = + (red)   bp = − (blue)
// ─────────────────────────────────────────────────────────────

(function (App) {

  const COLS        = 50;
  const HS          = 0.40;    // hole pitch  (world units)
  const BOARD_THICK = 0.38;
  const MARGIN_X    = 0.90;    // space left/right of first/last column

  // World-Z of every row centre.
  // Positive Z = near the viewer.  Negative Z = far side.
  // tp/tn live on the far side; bn/bp on the near side.
  const ROW_Z = {
    tp: -3.35, tn: -2.95,                                      // top rails
    a : -2.15, b : -1.75, c : -1.35, d : -0.95, e : -0.55,   // top body
    // ── centre channel (no holes) ──
    f :  0.55, g :  0.95, h :  1.35, i :  1.75, j :  2.15,   // bottom body
    bn:  2.95, bp:  3.35,                                      // bottom rails
  };

  // + − + −  (near-to-far):  tp=+  tn=−  bn=+  bp=−
  const RAIL_IS_POS = { tp: true, tn: false, bn: true, bp: false };

  const ALL_ROWS          = ['tp','tn','a','b','c','d','e','f','g','h','i','j','bn','bp'];
  const BODY_ROWS         = ['a','b','c','d','e','f','g','h','i','j'];
  const RAIL_ROWS         = ['tp','tn','bn','bp'];
  const BODY_ROWS_ORDERED = ['a','b','c','d','e','f','g','h','i','j'];

  const BOARD_W = (COLS - 1) * HS + 2 * MARGIN_X;   // ≈ 21.4
  const BOARD_D = 7.9;

  // ─────────────────────────────────────────────────────────────
  //  Canvas texture — all visual labelling lives here
  // ─────────────────────────────────────────────────────────────
  function buildTexture() {
    const CW = 2048, CH = 1024;
    const el  = document.createElement('canvas');
    el.width  = CW;
    el.height = CH;
    const ctx = el.getContext('2d');

    // World → canvas coordinate helpers
    const wx = x => (x + BOARD_W / 2) / BOARD_W * CW;
    const wz = z => (z + BOARD_D / 2) / BOARD_D * CH;

    // Pre-compute canvas X for every column centre
    const colPx = Array.from({ length: COLS }, (_, c) =>
      wx((c - (COLS - 1) / 2) * HS));

    // Body row Y extents (with a little padding)
    const PAD    = 26;  // px
    const topY1  = wz(ROW_Z.a) - PAD;
    const topY2  = wz(ROW_Z.e) + PAD;
    const botY1  = wz(ROW_Z.f) - PAD;
    const botY2  = wz(ROW_Z.j) + PAD;

    // ── 1. Board base ────────────────────────────────────────
    ctx.fillStyle = '#e5e0d2';
    ctx.fillRect(0, 0, CW, CH);

    // ── 2. Body half backgrounds (very subtle cream tint) ────
    ctx.fillStyle = 'rgba(200,192,170,0.18)';
    ctx.fillRect(0, topY1, CW, topY2 - topY1);
    ctx.fillRect(0, botY1, CW, botY2 - botY1);

    // ── 3. Rail colour bands (+ = red tint, − = blue tint) ──
    const bandH = (0.29 / BOARD_D) * CH;
    for (const rail of RAIL_ROWS) {
      const cy  = wz(ROW_Z[rail]);
      const isP = RAIL_IS_POS[rail];
      ctx.fillStyle = isP ? 'rgba(210,38,38,0.20)' : 'rgba(38,68,210,0.20)';
      ctx.fillRect(0, cy - bandH, CW, bandH * 2);
      // Thin solid centre stripe
      ctx.fillStyle = isP ? 'rgba(195,28,28,0.45)' : 'rgba(28,58,198,0.45)';
      ctx.fillRect(0, cy - 2, CW, 4);
    }

    // ── 4. Centre DIP channel ───────────────────────────────
    const chanY1 = wz(-0.31);
    const chanY2 = wz( 0.31);
    const cg = ctx.createLinearGradient(0, chanY1, 0, chanY2);
    cg.addColorStop(0,    '#9e9480');
    cg.addColorStop(0.45, '#877e6c');
    cg.addColorStop(0.55, '#877e6c');
    cg.addColorStop(1,    '#9e9480');
    ctx.fillStyle = cg;
    ctx.fillRect(0, chanY1, CW, chanY2 - chanY1);
    ctx.strokeStyle = '#605848';
    ctx.lineWidth = 1.5;
    for (const y of [chanY1, chanY2]) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
    }

    // ── 5. Column-group dividers every 5 (inside body rows) ─
    ctx.lineWidth = 1.5;
    for (let c = 5; c < COLS; c += 5) {
      const lx = (colPx[c - 1] + colPx[c]) / 2;
      ctx.strokeStyle = 'rgba(138,125,100,0.28)';
      for (const [y1, y2] of [[topY1, topY2], [botY1, botY2]]) {
        ctx.beginPath(); ctx.moveTo(lx, y1); ctx.lineTo(lx, y2); ctx.stroke();
      }
    }

    // ── 6. Edge tick marks every 5 columns ──────────────────
    const TICK_LEN = 14;
    for (let c = 0; c < COLS; c++) {
      const isMajor = (c + 1) % 10 === 0;
      const isMid   = (c + 1) % 5  === 0;
      if (c === 0 || isMid || isMajor) {
        const cx = colPx[c];
        ctx.lineWidth   = isMajor ? 2.5 : 1.8;
        ctx.strokeStyle = isMajor
          ? 'rgba(82,72,52,0.85)'
          : (c === 0 ? 'rgba(100,88,64,0.70)' : 'rgba(120,108,82,0.50)');
        const tl = isMajor ? TICK_LEN : TICK_LEN * 0.7;
        ctx.beginPath(); ctx.moveTo(cx, 0);       ctx.lineTo(cx, tl);       ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, CH - tl); ctx.lineTo(cx, CH);       ctx.stroke();
      }
    }

    // ── 7. Column numbers (every 5, plus col 1) ─────────────
    const numTopY = (wz(ROW_Z.tn) + wz(ROW_Z.a)) / 2;
    const numBotY = (wz(ROW_Z.j)  + wz(ROW_Z.bn)) / 2;
    ctx.font         = 'bold 17px "Courier New", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#4c4230';
    for (let c = 0; c < COLS; c++) {
      if (c === 0 || (c + 1) % 5 === 0) {
        const label = String(c + 1);
        ctx.fillText(label, colPx[c], numTopY);
        ctx.fillText(label, colPx[c], numBotY);
      }
    }

    // ── 8. Row letters (a – j) on both sides ─────────────────
    const leftX  = wx(-(BOARD_W / 2) + MARGIN_X * 0.50);
    const rightX = wx(  BOARD_W / 2  - MARGIN_X * 0.50);

    ctx.font      = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#48402e';
    for (const row of BODY_ROWS) {
      const cy = wz(ROW_Z[row]);
      ctx.fillText(row, leftX,  cy);
      ctx.fillText(row, rightX, cy);
    }

    // ── 9. Rail + / − symbols on both sides ─────────────────
    ctx.font = 'bold 23px "Courier New", monospace';
    for (const rail of RAIL_ROWS) {
      const cy  = wz(ROW_Z[rail]);
      const isP = RAIL_IS_POS[rail];
      ctx.fillStyle = isP ? '#be2020' : '#2032be';
      const sym = isP ? '+' : '−';
      ctx.fillText(sym, leftX,  cy);
      ctx.fillText(sym, rightX, cy);
    }

    // ── 10. Hole rings ───────────────────────────────────────
    // Each hole: brass rim + dark socket + depth shadow
    const RIM   = 10;   // canvas px — outer brass rim radius
    const HOLE  =  7;   // canvas px — inner hole radius
    for (const row of ALL_ROWS) {
      const cy = wz(ROW_Z[row]);
      for (let c = 0; c < COLS; c++) {
        const cx = colPx[c];

        // Brass rim with radial gradient for metallic sheen
        const rimG = ctx.createRadialGradient(cx - 1.5, cy - 2, 1, cx, cy, RIM);
        rimG.addColorStop(0,   '#ddb858');
        rimG.addColorStop(0.5, '#b08e38');
        rimG.addColorStop(1,   '#8a6c20');
        ctx.beginPath();
        ctx.arc(cx, cy, RIM, 0, Math.PI * 2);
        ctx.fillStyle = rimG;
        ctx.fill();

        // Dark socket
        ctx.beginPath();
        ctx.arc(cx, cy, HOLE, 0, Math.PI * 2);
        ctx.fillStyle = '#0d0b08';
        ctx.fill();

        // Depth shadow inside socket
        const shdG = ctx.createRadialGradient(cx, cy + 2, 1, cx, cy, HOLE);
        shdG.addColorStop(0,   'rgba(0,0,0,0.60)');
        shdG.addColorStop(0.65,'rgba(0,0,0,0.25)');
        shdG.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(cx, cy, HOLE, 0, Math.PI * 2);
        ctx.fillStyle = shdG;
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(el);
    tex.anisotropy = 4;
    return tex;
  }

  // ─────────────────────────────────────────────────────────────
  //  Board factory
  // ─────────────────────────────────────────────────────────────
  function createBreadboard() {
    const bbGroup  = new THREE.Group();
    bbGroup.name   = 'breadboard';
    const holeData = [];

    // ── 1. Body ──────────────────────────────────────────────
    const bodyGeo = new THREE.BoxGeometry(BOARD_W, BOARD_THICK, BOARD_D);
    const body    = new THREE.Mesh(bodyGeo,
      new THREE.MeshLambertMaterial({ color: 0xd8d4c8 }));
    body.position.y = -BOARD_THICK / 2;
    body.receiveShadow = body.castShadow = true;
    body.name = 'bb-body';
    bbGroup.add(body);

    // ── 2. Top face — full canvas texture ────────────────────
    const topFace = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W, BOARD_D),
      new THREE.MeshLambertMaterial({ map: buildTexture() })
    );
    topFace.rotation.x = -Math.PI / 2;
    topFace.position.y = 0.001;
    topFace.name = 'bb-top';
    bbGroup.add(topFace);

    // ── 3. 3-D rail colour strips (thin, reinforce canvas) ───
    const sW = BOARD_W - 1.4;
    function addRailStrip(zPos, isPos) {
      const col = isPos ? 0xbb1e1e : 0x1e30bb;
      const m   = new THREE.Mesh(
        new THREE.BoxGeometry(sW, 0.005, 0.21),
        new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.60 })
      );
      m.position.set(0, 0.003, zPos);
      bbGroup.add(m);
    }
    addRailStrip(ROW_Z.tp, true);    // + red
    addRailStrip(ROW_Z.tn, false);   // − blue
    addRailStrip(ROW_Z.bn, true);    // + red   ← CORRECTED
    addRailStrip(ROW_Z.bp, false);   // − blue  ← CORRECTED

    // ── 4. Centre DIP channel groove ─────────────────────────
    const chan = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W - 0.3, 0.010, 0.62),
      new THREE.MeshLambertMaterial({ color: 0x8c8270 })
    );
    chan.position.set(0, 0.002, 0);
    bbGroup.add(chan);

    // ── 5. Holes  (InstancedMesh — tapered for socket look) ──
    const totalHoles = COLS * ALL_ROWS.length;
    const holeGeo    = new THREE.CylinderGeometry(0.058, 0.046, BOARD_THICK + 0.04, 8);
    const holeMat    = new THREE.MeshLambertMaterial({ color: 0x0c0a08 });
    const holesMesh  = new THREE.InstancedMesh(holeGeo, holeMat, totalHoles);
    holesMesh.name   = 'bb-holes';

    const dummy = new THREE.Object3D();
    let   idx   = 0;
    ALL_ROWS.forEach(row => {
      const z = ROW_Z[row];
      for (let col = 0; col < COLS; col++) {
        const x = (col - (COLS - 1) / 2) * HS;
        dummy.position.set(x, 0, z);
        dummy.updateMatrix();
        holesMesh.setMatrixAt(idx, dummy.matrix);
        holeData.push({ idx, col, row, x, z,
          world: new THREE.Vector3(x, 0, z), occupied: false });
        idx++;
      }
    });
    holesMesh.instanceMatrix.needsUpdate = true;
    bbGroup.add(holesMesh);

    // ── 6. Edge banding (plastic lips around the board) ──────
    const edgeMat = new THREE.MeshLambertMaterial({ color: 0xb4aca0 });
    // Long sides
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(BOARD_W + 0.12, BOARD_THICK + 0.05, 0.07),
        edgeMat
      );
      m.position.set(0, -BOARD_THICK / 2, s * (BOARD_D / 2 + 0.035));
      bbGroup.add(m);
    }
    // Short sides
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, BOARD_THICK + 0.05, BOARD_D + 0.14),
        edgeMat
      );
      m.position.set(s * (BOARD_W / 2 + 0.035), -BOARD_THICK / 2, 0);
      bbGroup.add(m);
    }

    // ── Helpers ───────────────────────────────────────────────

    function getNearestHole(qx, qz, onlyRows) {
      let best = null, bestD = Infinity;
      for (const h of holeData) {
        if (onlyRows && !onlyRows.includes(h.row)) continue;
        const d = (h.x - qx) ** 2 + (h.z - qz) ** 2;
        if (d < bestD) { bestD = d; best = h; }
      }
      return bestD < 1.8 ? best : null;
    }

    function getHole(col, row) {
      return holeData.find(h => h.col === col && h.row === row) ?? null;
    }

    function getSpanHole(startHole, span, rotation) {
      if (rotation === 0) {
        return getHole(startHole.col + span, startHole.row);
      }
      const ri = BODY_ROWS_ORDERED.indexOf(startHole.row);
      if (ri < 0) return null;
      const newRow = BODY_ROWS_ORDERED[ri + span];
      return newRow ? getHole(startHole.col, newRow) : null;
    }

    return {
      group: bbGroup,
      holesMesh,
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
