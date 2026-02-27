// ─────────────────────────────────────────────────────────────
//  components.js — 3D models for: Resistor, LED, Battery
//
//  Each builder returns:
//    { group: THREE.Group, pins: THREE.Vector3[] }
//
//  Pins are world-space positions where wires can attach.
//
//  Exports: App.buildResistor, App.buildLED, App.buildBattery
// ─────────────────────────────────────────────────────────────

(function (App) {

  // Shared lead material (silver wire)
  const LEAD_MAT = new THREE.MeshLambertMaterial({ color: 0xc0c0c0 });

  // Resistor band colors (ohm color code)
  const BAND_COLORS = [
    0xf87171,  // red
    0xfb923c,  // orange
    0xfbbf24,  // yellow
    0xa3e635,  // green-yellow
    0x834d14,  // gold (tolerance)
  ];

  // ── RESISTOR ────────────────────────────────────────────────
  //
  //  holeA / holeB: { x, z } world positions of the two mounting holes.
  //  The resistor body arcs horizontally above the board between them.
  //
  function buildResistor(holeA, holeB) {
    const group = new THREE.Group();

    const ax = holeA.x, az = holeA.z;
    const bx = holeB.x, bz = holeB.z;
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;

    const LEAD_H    = 0.75;  // how tall the vertical lead rises
    const BODY_R    = 0.14;  // body cylinder radius
    const BODY_LEN  = Math.max(0.5, Math.abs(bx - ax) * 0.55);

    // Vertical leads (go up from holes)
    const vLeadGeo = new THREE.CylinderGeometry(0.025, 0.025, LEAD_H, 7);
    [ax, bx].forEach(x => {
      const l = new THREE.Mesh(vLeadGeo, LEAD_MAT);
      l.position.set(x, LEAD_H / 2, midZ);
      group.add(l);
    });

    // Horizontal lead segments connecting top of vertical leads to body ends
    const hOffset = BODY_LEN / 2 + 0.02;
    const hSpanL  = Math.abs(ax - (midX - hOffset));
    const hSpanR  = Math.abs(bx - (midX + hOffset));

    if (hSpanL > 0.01) {
      const g = new THREE.CylinderGeometry(0.025, 0.025, hSpanL, 7);
      const m = new THREE.Mesh(g, LEAD_MAT);
      m.rotation.z = Math.PI / 2;
      m.position.set((ax + midX - hOffset) / 2, LEAD_H, midZ);
      group.add(m);
    }
    if (hSpanR > 0.01) {
      const g = new THREE.CylinderGeometry(0.025, 0.025, hSpanR, 7);
      const m = new THREE.Mesh(g, LEAD_MAT);
      m.rotation.z = Math.PI / 2;
      m.position.set((bx + midX + hOffset) / 2, LEAD_H, midZ);
      group.add(m);
    }

    // Body (tan cylinder)
    const bodyGeo = new THREE.CylinderGeometry(BODY_R, BODY_R, BODY_LEN, 16);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xd4a96a });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.rotation.z = Math.PI / 2;
    bodyMesh.position.set(midX, LEAD_H, midZ);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // Color bands
    const numBands = 4;
    const bandWidth = BODY_LEN * 0.12;
    const spacing   = BODY_LEN / (numBands + 1);
    const startX    = midX - BODY_LEN / 2 + spacing;

    for (let i = 0; i < numBands; i++) {
      const col = BAND_COLORS[i % BAND_COLORS.length];
      const bGeo = new THREE.CylinderGeometry(BODY_R + 0.005, BODY_R + 0.005, bandWidth, 16);
      const bMat = new THREE.MeshLambertMaterial({ color: col });
      const band = new THREE.Mesh(bGeo, bMat);
      band.rotation.z = Math.PI / 2;
      band.position.set(startX + i * spacing, LEAD_H, midZ);
      group.add(band);
    }

    // Pin positions = where leads enter the board
    const pins = [
      new THREE.Vector3(ax, 0, midZ),
      new THREE.Vector3(bx, 0, midZ),
    ];

    return { group, pins };
  }

  // ── LED ─────────────────────────────────────────────────────
  //
  //  holeA: cathode (−), holeB: anode (+)
  //  color: hex number, e.g. 0xff2222
  //
  function buildLED(holeA, holeB, color) {
    color = color || 0xff2222;
    const group = new THREE.Group();

    const ax = holeA.x, az = holeA.z;
    const bx = holeB.x, bz = holeB.z;
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;

    const LEAD_H = 0.90;

    // Vertical leads
    // Anode lead is slightly taller (standard LED convention)
    const leadShort = new THREE.CylinderGeometry(0.024, 0.024, LEAD_H - 0.08, 7);
    const leadLong  = new THREE.CylinderGeometry(0.024, 0.024, LEAD_H, 7);

    const cathode = new THREE.Mesh(leadShort, LEAD_MAT); // shorter = cathode (−)
    cathode.position.set(ax, (LEAD_H - 0.08) / 2, midZ);
    group.add(cathode);

    const anode = new THREE.Mesh(leadLong, LEAD_MAT);    // longer = anode (+)
    anode.position.set(bx, LEAD_H / 2, midZ);
    group.add(anode);

    // Skirt / collar (dark plastic base)
    const collarGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.12, 18);
    const collarMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const collar    = new THREE.Mesh(collarGeo, collarMat);
    collar.position.set(midX, LEAD_H - 0.02, midZ);
    group.add(collar);

    // Flat base disc
    const baseGeo = new THREE.CylinderGeometry(0.188, 0.188, 0.04, 18);
    const baseMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const base    = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(midX, LEAD_H - 0.08, midZ);
    group.add(base);

    // Dome (transparent, colored, slightly emissive)
    const domeGeo = new THREE.SphereGeometry(0.185, 22, 11, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const domeMat = new THREE.MeshLambertMaterial({
      color:            color,
      emissive:         color,
      emissiveIntensity: 0.45,
      transparent:      true,
      opacity:          0.88,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(midX, LEAD_H + 0.04, midZ);
    dome.castShadow = true;
    group.add(dome);

    const pins = [
      new THREE.Vector3(ax, 0, midZ), // cathode
      new THREE.Vector3(bx, 0, midZ), // anode
    ];

    return { group, pins };
  }

  // ── BATTERY (9V) ─────────────────────────────────────────────
  //
  //  Placed freely in the scene (not on the breadboard).
  //  worldX / worldZ: center position on the ground plane.
  //
  //  Two pin positions:
  //    pins[0] = positive (+) terminal
  //    pins[1] = negative (−) terminal
  //
  function buildBattery(worldX, worldZ) {
    const group = new THREE.Group();

    const W = 2.0;  // width
    const H = 2.6;  // height
    const D = 1.4;  // depth

    // ── Main black body ────────────────────────────────────
    const bodyGeo = new THREE.BoxGeometry(W, H, D);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const body    = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = H / 2;
    body.castShadow = true;
    group.add(body);

    // ── Blue label band ────────────────────────────────────
    const labelGeo = new THREE.BoxGeometry(W - 0.01, H * 0.55, D + 0.01);
    const labelMat = new THREE.MeshLambertMaterial({ color: 0x1a3a9a });
    const label    = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(0, H * 0.52, 0);
    group.add(label);

    // "9V" white rectangle on label face
    const textGeo = new THREE.BoxGeometry(0.6, 0.22, D + 0.02);
    const textMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const textMsh = new THREE.Mesh(textGeo, textMat);
    textMsh.position.set(0, H * 0.52, 0);
    group.add(textMsh);

    // ── Snap connector platform on top ─────────────────────
    const snapGeo = new THREE.BoxGeometry(W * 0.65, 0.22, D * 0.55);
    const snapMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const snap    = new THREE.Mesh(snapGeo, snapMat);
    snap.position.set(0, H + 0.11, 0);
    group.add(snap);

    // ── Positive terminal — smaller round post ──────────────
    const posCapGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.28, 14);
    const posCapMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
    const posCap    = new THREE.Mesh(posCapGeo, posCapMat);
    posCap.position.set(-0.32, H + 0.36, 0);
    group.add(posCap);

    // Red '+' indicator disc
    const plusGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.04, 12);
    const plusMat = new THREE.MeshLambertMaterial({ color: 0xff3333, emissive: 0x440000, emissiveIntensity: 0.3 });
    const plusDsc = new THREE.Mesh(plusGeo, plusMat);
    plusDsc.position.set(-0.32, H + 0.52, 0);
    group.add(plusDsc);

    // ── Negative terminal — larger ring ─────────────────────
    const negRingGeo = new THREE.TorusGeometry(0.24, 0.09, 9, 18);
    const negRingMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const negRing    = new THREE.Mesh(negRingGeo, negRingMat);
    negRing.rotation.x = Math.PI / 2;
    negRing.position.set(0.32, H + 0.25, 0);
    group.add(negRing);

    // Blue '−' indicator disc
    const minusGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.03, 18);
    const minusMat = new THREE.MeshLambertMaterial({ color: 0x2255cc, emissive: 0x001040, emissiveIntensity: 0.3 });
    const minusDsc = new THREE.Mesh(minusGeo, minusMat);
    minusDsc.position.set(0.32, H + 0.11, 0);
    group.add(minusDsc);

    // ── World position ──────────────────────────────────────
    group.position.set(worldX, 0, worldZ);

    // Pin world positions (top of each terminal)
    const pins = [
      new THREE.Vector3(worldX - 0.32, H + 0.52, worldZ), // + (positive)
      new THREE.Vector3(worldX + 0.32, H + 0.25, worldZ), // − (negative)
    ];

    return { group, pins };
  }

  // ── Exports ────────────────────────────────────────────────
  App.buildResistor = buildResistor;
  App.buildLED      = buildLED;
  App.buildBattery  = buildBattery;

})(window.App = window.App || {});
