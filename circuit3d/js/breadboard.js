// ─────────────────────────────────────────────────────────────
//  breadboard.js — The 3D breadboard
//
//  Rail polarity (+ − + − reading far-viewer → near-viewer):
//    tp = + (red)   tn = − (blue)
//    bn = + (red)   bp = − (blue)
//
//  The holes are drawn, not modelled: a square socket in the colour
//  texture plus a matching dip in the bump map. They used to be 700
//  cylinders taller than the board, which rendered as a field of black
//  pegs sticking out of it.
// ─────────────────────────────────────────────────────────────

(function (App) {

  // ── Board geometry — the single source of truth ────────────────
  //  Exported as App.BOARD_GEOMETRY so app.js and the board text handed to the
  //  model read the same numbers. src/constants.ts is a second copy for Remotion:
  //  the two runtimes share no module, so it has to be kept in step by hand.
  const GEOMETRY = {
    COLS:        50,
    HS:          0.40,   // hole pitch  (world units; 0.1 inch)
    BOARD_THICK: 0.38,
    MARGIN_X:    0.90,   // space left/right of first/last column
    BOARD_D:     7.9,

    // World-Z of every row centre.
    // Positive Z = near the viewer.  Negative Z = far side.
    // tp/tn live on the far side; bn/bp on the near side.
    ROW_Z: {
      tp: -3.35, tn: -2.95,                                    // top rails
      a : -2.15, b : -1.75, c : -1.35, d : -0.95, e : -0.55,   // top body
      // ── centre channel (no holes) ──
      f :  0.55, g :  0.95, h :  1.35, i :  1.75, j :  2.15,   // bottom body
      bn:  2.95, bp:  3.35,                                    // bottom rails
    },

    // + − + −  (far-to-near):  tp=+  tn=−  bn=+  bp=−
    RAIL_IS_POS: { tp: true, tn: false, bn: true, bp: false },

    ALL_ROWS:  ['tp','tn','a','b','c','d','e','f','g','h','i','j','bn','bp'],
    BODY_ROWS: ['a','b','c','d','e','f','g','h','i','j'],
    RAIL_ROWS: ['tp','tn','bn','bp'],
  };
  GEOMETRY.BOARD_W     = (GEOMETRY.COLS - 1) * GEOMETRY.HS + 2 * GEOMETRY.MARGIN_X;
  GEOMETRY.TOTAL_HOLES = GEOMETRY.COLS * GEOMETRY.ALL_ROWS.length;
  App.BOARD_GEOMETRY   = GEOMETRY;

  const { COLS, HS, BOARD_THICK, MARGIN_X, ROW_Z, RAIL_IS_POS,
          ALL_ROWS, BODY_ROWS, RAIL_ROWS, BOARD_W, BOARD_D } = GEOMETRY;

  // Board description handed to the model, generated from GEOMETRY.
  App.boardTopologyText = function () {
    const half = BODY_ROWS.length / 2;
    const t0 = BODY_ROWS[0], t1 = BODY_ROWS[half - 1];
    const b0 = BODY_ROWS[half], b1 = BODY_ROWS[BODY_ROWS.length - 1];
    return `## Breadboard topology (always true)
- Columns 1-${COLS}. Holes ${t0}1-${t1}1 share one node; ${b0}1-${b1}1 share another node (center channel divides them).
- Same rule for every column: ${t0}-${t1} connected together, ${b0}-${b1} connected together.
- To connect top half (${t0}-${t1}) to bottom half (${b0}-${b1}) of the SAME column, you MUST add a wire.
- tp = positive top rail (+9V), tn = negative top rail (GND).
- bn = positive bottom rail (+9V), bp = negative bottom rail (GND).
- Rails are NOT connected to body rows — you must wire from rail to a body hole explicitly.
- Every hole holds exactly one lead or one wire end.
- ${GEOMETRY.TOTAL_HOLES} holes total: ${COLS} columns × ${ALL_ROWS.length} rows.`;
  };

  // ── Hole addresses ────────────────────────────────────────────
  //  One format, used by the exporter and by the action parser: body holes
  //  are "<row><col>" (e14), rails take an underscore ("tp_14") so the
  //  two-letter row name stays readable.  Columns are 1-based in an address
  //  and 0-based in holeData.
  const HOLE_ADDRESS_RE = /^(tp|tn|bn|bp)_(\d+)$|^([a-j])(\d+)$/i;

  function formatHole(ref) {
    if (!ref || !ALL_ROWS.includes(ref.row) || !(ref.col >= 0 && ref.col < COLS)) {
      throw new Error('formatHole: not a board hole: ' + JSON.stringify(ref));
    }
    return ref.row + (RAIL_ROWS.includes(ref.row) ? '_' : '') + (ref.col + 1);
  }

  function parseHole(str) {
    const m = HOLE_ADDRESS_RE.exec(String(str));
    if (!m) throw new Error('parseHole: unrecognised hole address: ' + str);
    const col = parseInt(m[2] || m[4], 10) - 1;
    if (col < 0 || col >= COLS) {
      throw new Error('parseHole: column out of range 1-' + COLS + ': ' + str);
    }
    return { col, row: (m[1] || m[3]).toLowerCase() };
  }

  App.formatHole = formatHole;   // { col, row } -> "e14" / "tp_14"
  App.parseHole  = parseHole;    // "tp_14" -> { col, row }, throws if it cannot

  const colX = c => (c - (COLS - 1) / 2) * HS;

  // ─────────────────────────────────────────────────────────────
  //  Printed face: colour texture and bump map, drawn together
  // ─────────────────────────────────────────────────────────────
  const TEX_W = 4096;
  const TEX_H = Math.round(TEX_W * BOARD_D / BOARD_W);
  const PX    = TEX_W / BOARD_W;                     // texels per world unit

  const wx = x => (x + BOARD_W / 2) * PX;
  const wz = z => (z + BOARD_D / 2) * PX;

  const FONT = '"Inter", "Segoe UI", Arial, sans-serif';

  function drawFace(ctx, bump) {
    const W = TEX_W, H = TEX_H;
    const base = bump ? '#8a8a8a' : '#f2efe8';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // plastic grain, colour only
    if (!bump) {
      const img = ctx.getImageData(0, 0, W, H);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 5;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
    }

    // ── Centre channel: a groove, darker in the middle ──────
    const c1 = wz(-0.31), c2 = wz(0.31);
    const cg = ctx.createLinearGradient(0, c1, 0, c2);
    if (bump) {
      cg.addColorStop(0, '#6a6a6a'); cg.addColorStop(0.18, '#262626');
      cg.addColorStop(0.82, '#262626'); cg.addColorStop(1, '#6a6a6a');
    } else {
      cg.addColorStop(0,    '#c9c3b6');
      cg.addColorStop(0.12, '#a39c8e');
      cg.addColorStop(0.5,  '#b8b1a3');
      cg.addColorStop(0.88, '#a39c8e');
      cg.addColorStop(1,    '#d9d4c8');
    }
    ctx.fillStyle = cg;
    ctx.fillRect(0, c1, W, c2 - c1);

    // ── Rail separation grooves (rails are separate strips) ──
    for (const z of [-2.55, 2.55]) {
      ctx.fillStyle = bump ? '#5a5a5a' : '#dcd7cb';
      ctx.fillRect(0, wz(z) - 3, W, 6);
    }

    if (!bump) {
      // ── Printed rail stripes: red beside +, blue beside − ──
      const stripe = (z, color) => { ctx.fillStyle = color; ctx.fillRect(wx(-BOARD_W / 2 + 0.5), wz(z) - 4, wx(BOARD_W / 2 - 0.5) - wx(-BOARD_W / 2 + 0.5), 8); };
      stripe(ROW_Z.tp - 0.24, '#d64541');
      stripe(ROW_Z.tn + 0.24, '#3867d6');
      stripe(ROW_Z.bn - 0.24, '#d64541');
      stripe(ROW_Z.bp + 0.24, '#3867d6');

      // ── + / − at both ends of every rail ─────────────────
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 50px ${FONT}`;
      for (const rail of RAIL_ROWS) {
        const pos = RAIL_IS_POS[rail];
        ctx.fillStyle = pos ? '#c0392b' : '#2d5bc4';
        const z = wz(ROW_Z[rail]);
        ctx.fillText(pos ? '+' : '−', wx(-BOARD_W / 2 + MARGIN_X * 0.45), z);
        ctx.fillText(pos ? '+' : '−', wx(BOARD_W / 2 - MARGIN_X * 0.45), z);
      }

      // ── Column numbers every 5, row letters at both ends ──
      ctx.fillStyle = '#5f594e';
      ctx.font = `600 30px ${FONT}`;
      const topNum = wz((ROW_Z.tn + ROW_Z.a) / 2 + 0.06);
      const botNum = wz((ROW_Z.j + ROW_Z.bn) / 2 - 0.06);
      for (let c = 0; c < COLS; c++) {
        if (c !== 0 && (c + 1) % 5 !== 0) continue;
        ctx.fillText(String(c + 1), wx(colX(c)), topNum);
        ctx.fillText(String(c + 1), wx(colX(c)), botNum);
      }
      ctx.font = `600 32px ${FONT}`;
      for (const row of BODY_ROWS) {
        const z = wz(ROW_Z[row]);
        ctx.fillText(row, wx(-BOARD_W / 2 + MARGIN_X * 0.45), z);
        ctx.fillText(row, wx(BOARD_W / 2 - MARGIN_X * 0.45), z);
      }
    }

    // ── Holes: square sockets with a chamfered rim ───────────
    const OUT = Math.round(0.155 * PX), IN = Math.round(0.105 * PX);
    for (const row of ALL_ROWS) {
      const cy = Math.round(wz(ROW_Z[row]));
      for (let c = 0; c < COLS; c++) {
        const cx = Math.round(wx(colX(c)));
        if (bump) {
          ctx.fillStyle = '#4a4a4a';
          ctx.fillRect(cx - OUT / 2, cy - OUT / 2, OUT, OUT);
          ctx.fillStyle = '#000000';
          ctx.fillRect(cx - IN / 2, cy - IN / 2, IN, IN);
          continue;
        }
        // chamfer: lit on the far edge, shaded on the near edge
        const ch = ctx.createLinearGradient(0, cy - OUT / 2, 0, cy + OUT / 2);
        ch.addColorStop(0, '#b9b3a6');
        ch.addColorStop(1, '#e6e2d8');
        ctx.fillStyle = ch;
        ctx.fillRect(cx - OUT / 2, cy - OUT / 2, OUT, OUT);
        // the socket, with the metal clip just visible at the bottom
        const s = ctx.createLinearGradient(0, cy - IN / 2, 0, cy + IN / 2);
        s.addColorStop(0, '#1a1814');
        s.addColorStop(0.7, '#2b2822');
        s.addColorStop(1, '#6f6a60');
        ctx.fillStyle = s;
        ctx.fillRect(cx - IN / 2, cy - IN / 2, IN, IN);
      }
    }
  }

  function buildFaceTextures(renderer) {
    const make = bump => {
      const el = document.createElement('canvas');
      el.width = TEX_W; el.height = TEX_H;
      drawFace(el.getContext('2d'), bump);
      const t = new THREE.CanvasTexture(el);
      t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
      if (!bump) t.encoding = THREE.sRGBEncoding;
      return { el, t };
    };
    const color = make(false), bump = make(true);
    // The labels use Inter; redraw once the web font is actually available.
    if (document.fonts && document.fonts.load) {
      document.fonts.load(`600 30px Inter`).then(() => {
        drawFace(color.el.getContext('2d'), false);
        color.t.needsUpdate = true;
      }).catch(() => {});
    }
    return { map: color.t, bumpMap: bump.t };
  }

  function roundedRect(w, d, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  // ─────────────────────────────────────────────────────────────
  //  Board factory
  // ─────────────────────────────────────────────────────────────
  function createBreadboard() {
    const bbGroup  = new THREE.Group();
    bbGroup.name   = 'breadboard';
    const holeData = [];

    const plastic = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xebe7de).convertSRGBToLinear(), roughness: 0.62, metalness: 0, envMapIntensity: 0.7 });

    // ── 1. Body: rounded slab with a soft bevel ──────────────
    const BEV = 0.035;
    const bodyGeo = new THREE.ExtrudeGeometry(roundedRect(BOARD_W - 2 * BEV, BOARD_D - 2 * BEV, 0.16), {
      depth: BOARD_THICK - 2 * BEV, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 3, curveSegments: 6,
    });
    bodyGeo.rotateX(-Math.PI / 2);           // extrusion now points up
    bodyGeo.translate(0, -BOARD_THICK + BEV, 0);
    const body = new THREE.Mesh(bodyGeo, plastic);
    body.receiveShadow = true;
    body.castShadow = true;
    body.name = 'bb-body';
    bbGroup.add(body);

    // ── 2. Printed face ──────────────────────────────────────
    const tex = buildFaceTextures(App.renderer);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W - 0.02, BOARD_D - 0.02),
      new THREE.MeshStandardMaterial({
        map: tex.map, bumpMap: tex.bumpMap, bumpScale: 0.018,
        roughness: 0.58, metalness: 0, envMapIntensity: 0.7,
      })
    );
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.0015;
    face.receiveShadow = true;
    face.name = 'bb-top';
    bbGroup.add(face);

    // ── 3. Hole pick targets (never drawn) ───────────────────
    //  Kept as an InstancedMesh so hover and click can raycast holes
    //  directly; the material is invisible, the geometry is a flat pad.
    const totalHoles = COLS * ALL_ROWS.length;
    const pickMat    = new THREE.MeshBasicMaterial({ visible: false });
    const holesMesh  = new THREE.InstancedMesh(new THREE.BoxGeometry(HS * 0.9, 0.02, HS * 0.9), pickMat, totalHoles);
    holesMesh.name   = 'bb-holes';

    const dummy = new THREE.Object3D();
    let   idx   = 0;
    ALL_ROWS.forEach(row => {
      const z = ROW_Z[row];
      for (let col = 0; col < COLS; col++) {
        const x = colX(col);
        dummy.position.set(x, 0.01, z);
        dummy.updateMatrix();
        holesMesh.setMatrixAt(idx, dummy.matrix);
        holeData.push({ idx, col, row, x, z,
          world: new THREE.Vector3(x, 0, z), occupied: false });
        idx++;
      }
    });
    holesMesh.instanceMatrix.needsUpdate = true;
    bbGroup.add(holesMesh);

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
      const ri = BODY_ROWS.indexOf(startHole.row);
      if (ri < 0) return null;
      const newRow = BODY_ROWS[ri + span];
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
    };
  }

  App.createBreadboard = createBreadboard;

})(window.App = window.App || {});
