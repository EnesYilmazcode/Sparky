// ─────────────────────────────────────────────────────────────
//  components.js — 3D models for Resistor, LED, Battery
//                  + ghost (transparent preview) versions
//
//  Placement builders (buildResistor / buildLED / buildBattery):
//    Accept hole objects {x, z} and return { group, pins }.
//    pins[i] is the world Vector3 of the i-th electrical pin.
//
//  Preview builder (buildPreview):
//    Returns a transparent ghost Group centred at (0,0,0).
//    Caller repositions it each frame.
//
//  Exports: App.buildResistor, App.buildLED,
//           App.buildBattery, App.buildPreview
// ─────────────────────────────────────────────────────────────

(function (App) {

  const LEAD_MAT = () => new THREE.MeshLambertMaterial({ color: 0xc0c0c0 });

  const BAND_COLORS = [0xf87171, 0xfb923c, 0xfbbf24, 0xa3e635, 0x834d14];

  // ─── Helpers ─────────────────────────────────────────────────

  function ghostMat(hexColor, opacity = 0.42) {
    return new THREE.MeshLambertMaterial({
      color: hexColor, transparent: true, opacity, depthWrite: false,
    });
  }

  function cylinder(r, h, segs, mat) {
    return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segs), mat);
  }

  function box(w, h, d, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }

  // ─────────────────────────────────────────────────────────────
  //  RESISTOR
  //
  //  holeA / holeB: hole objects from holeData, { x, z }
  //  The resistor arcs horizontally (or vertically) between them.
  //  Thinner body than before.
  // ─────────────────────────────────────────────────────────────
  function buildResistor(holeA, holeB) {
    const group = new THREE.Group();
    const ax = holeA.x, az = holeA.z;
    const bx = holeB.x, bz = holeB.z;
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;

    // Determine orientation: horizontal (same z) or vertical (same x)
    const isHoriz = Math.abs(az - bz) < 0.01;
    const LEAD_H  = 0.72;
    const BODY_R  = 0.10;  // thinner than before

    // Body length = distance minus a bit so it doesn't reach the hole edges
    const bodyLen = Math.max(0.4,
      isHoriz ? Math.abs(bx - ax) * 0.56 : Math.abs(bz - az) * 0.56
    );

    // Vertical leads from holes up to body height
    const vLGeo = new THREE.CylinderGeometry(0.022, 0.022, LEAD_H, 7);
    [{ x: ax, z: az }, { x: bx, z: bz }].forEach(({ x, z }) => {
      const l = new THREE.Mesh(vLGeo, LEAD_MAT());
      l.position.set(x, LEAD_H / 2, z);
      group.add(l);
    });

    // Horizontal lead stubs connecting vertical tops to body
    const hOff = bodyLen / 2 + 0.01;
    const lMat = LEAD_MAT();
    if (isHoriz) {
      const spanL = Math.abs(ax - (midX - hOff));
      const spanR = Math.abs(bx - (midX + hOff));
      if (spanL > 0.01) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, spanL, 7), lMat);
        m.rotation.z = Math.PI / 2;
        m.position.set((ax + midX - hOff) / 2, LEAD_H, midZ);
        group.add(m);
      }
      if (spanR > 0.01) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, spanR, 7), lMat);
        m.rotation.z = Math.PI / 2;
        m.position.set((bx + midX + hOff) / 2, LEAD_H, midZ);
        group.add(m);
      }
    } else {
      const spanT = Math.abs(az - (midZ - hOff));
      const spanB = Math.abs(bz - (midZ + hOff));
      if (spanT > 0.01) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, spanT, 7), lMat);
        m.rotation.x = Math.PI / 2;
        m.position.set(midX, LEAD_H, (az + midZ - hOff) / 2);
        group.add(m);
      }
      if (spanB > 0.01) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, spanB, 7), lMat);
        m.rotation.x = Math.PI / 2;
        m.position.set(midX, LEAD_H, (bz + midZ + hOff) / 2);
        group.add(m);
      }
    }

    // Body
    const bodyGeo = new THREE.CylinderGeometry(BODY_R, BODY_R, bodyLen, 14);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xd4a96a });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.castShadow = true;
    if (isHoriz) bodyMesh.rotation.z = Math.PI / 2;
    else         bodyMesh.rotation.x = Math.PI / 2;
    bodyMesh.position.set(midX, LEAD_H, midZ);
    group.add(bodyMesh);

    // Colour bands
    const numBands = 4;
    const bSpace   = bodyLen / (numBands + 1);
    for (let i = 0; i < numBands; i++) {
      const bGeo = new THREE.CylinderGeometry(BODY_R + 0.004, BODY_R + 0.004, bodyLen * 0.1, 14);
      const bMat = new THREE.MeshLambertMaterial({ color: BAND_COLORS[i % BAND_COLORS.length] });
      const band = new THREE.Mesh(bGeo, bMat);
      if (isHoriz) {
        band.rotation.z = Math.PI / 2;
        band.position.set(midX - bodyLen / 2 + bSpace * (i + 1), LEAD_H, midZ);
      } else {
        band.rotation.x = Math.PI / 2;
        band.position.set(midX, LEAD_H, midZ - bodyLen / 2 + bSpace * (i + 1));
      }
      group.add(band);
    }

    const pins = [
      new THREE.Vector3(ax, 0, az),
      new THREE.Vector3(bx, 0, bz),
    ];
    return { group, pins };
  }

  // ─────────────────────────────────────────────────────────────
  //  LED
  //
  //  LED convention (same as real LEDs):
  //    pin 0 = CATHODE (−) — shorter lead, flat on one side of collar
  //    pin 1 = ANODE   (+) — longer lead
  //
  //  holeA = cathode (−), holeB = anode (+)
  // ─────────────────────────────────────────────────────────────
  function buildLED(holeA, holeB, color) {
    color = color || 0xff2222;
    const group = new THREE.Group();

    const ax = holeA.x, az = holeA.z;
    const bx = holeB.x, bz = holeB.z;
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;

    const CATHODE_H = 0.70;  // shorter  → cathode (−)
    const ANODE_H   = 1.00;  // longer   → anode   (+)
    const lMat = LEAD_MAT();

    // Cathode lead (shorter, pin 0)
    const cGeo  = new THREE.CylinderGeometry(0.023, 0.023, CATHODE_H, 7);
    const cLead = new THREE.Mesh(cGeo, lMat.clone());
    cLead.position.set(ax, CATHODE_H / 2, az);
    group.add(cLead);

    // Anode lead (longer, pin 1)
    const aGeo  = new THREE.CylinderGeometry(0.023, 0.023, ANODE_H, 7);
    const aLead = new THREE.Mesh(aGeo, lMat.clone());
    aLead.position.set(bx, ANODE_H / 2, bz);
    group.add(aLead);

    const bodyY = (CATHODE_H + ANODE_H) / 2; // dome sits between the two lead heights

    // Skirt/collar — flat on cathode side (real LED convention)
    const collarGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.11, 18);
    const collar    = new THREE.Mesh(collarGeo, new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
    collar.position.set(midX, bodyY - 0.04, midZ);
    group.add(collar);

    // Flat cut on collar (cathode side indicator)
    const cutBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.12, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
    );
    // Place cut on the side of the collar facing holeA (cathode)
    const catDir = new THREE.Vector3(ax - midX, 0, az - midZ).normalize();
    cutBox.position.set(midX + catDir.x * 0.14, bodyY - 0.04, midZ + catDir.z * 0.14);
    group.add(cutBox);

    // Dome
    const domeGeo = new THREE.SphereGeometry(0.185, 22, 11, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const dome    = new THREE.Mesh(domeGeo, new THREE.MeshLambertMaterial({
      color, emissive: color, emissiveIntensity: 0.45, transparent: true, opacity: 0.88,
    }));
    dome.position.set(midX, bodyY + 0.04, midZ);
    dome.castShadow = true;
    group.add(dome);

    // "+" label above the anode lead for clarity
    const plusMat = new THREE.MeshLambertMaterial({ color: 0xff3333 });
    const plusV   = box(0.04, 0.01, 0.14, plusMat);
    const plusH   = box(0.14, 0.01, 0.04, plusMat);
    [plusV, plusH].forEach(m => { m.position.set(bx, 0.03, bz); group.add(m); });

    // "−" label above cathode lead
    const minusMat = new THREE.MeshLambertMaterial({ color: 0x3355ff });
    const minus    = box(0.12, 0.01, 0.04, minusMat);
    minus.position.set(ax, 0.03, az);
    group.add(minus);

    const pins = [
      new THREE.Vector3(ax, 0, az),  // pin 0 = cathode (−)
      new THREE.Vector3(bx, 0, bz),  // pin 1 = anode   (+)
    ];
    return { group, pins };
  }

  // ─────────────────────────────────────────────────────────────
  //  BATTERY (9V)
  //
  //  Placed freely in the scene (not on the breadboard).
  //  pin 0 = positive (+),  pin 1 = negative (−)
  // ─────────────────────────────────────────────────────────────
  function buildBattery(wx, wz) {
    const group = new THREE.Group();
    const W = 2.0, H = 2.6, D = 1.4;

    // Body
    const body = box(W, H, D, new THREE.MeshLambertMaterial({ color: 0x111111 }));
    body.position.y = H / 2;
    body.castShadow = true;
    group.add(body);

    // Blue label band
    const label = box(W - 0.01, H * 0.55, D + 0.01,
      new THREE.MeshLambertMaterial({ color: 0x1a3a9a }));
    label.position.set(0, H * 0.52, 0);
    group.add(label);

    // "9V" white rectangle
    const nineV = box(0.6, 0.22, D + 0.02, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    nineV.position.set(0, H * 0.52, 0);
    group.add(nineV);

    // Snap connector platform
    const snap = box(W * 0.65, 0.22, D * 0.55, new THREE.MeshLambertMaterial({ color: 0x333333 }));
    snap.position.set(0, H + 0.11, 0);
    group.add(snap);

    // ── POSITIVE terminal (left, smaller round post + big red ring) ──
    const posCap = cylinder(0.13, 0.30, 14,
      new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    posCap.position.set(-0.32, H + 0.37, 0);
    group.add(posCap);

    // Red disc — unmistakeable "+"
    const posDisc = cylinder(0.17, 0.06, 16,
      new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0x550000, emissiveIntensity: 0.4 }));
    posDisc.position.set(-0.32, H + 0.54, 0);
    group.add(posDisc);

    // Big "+" symbol on positive disc (raised)
    const plusMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const plusV = box(0.04, 0.02, 0.2,  plusMat);
    const plusH = box(0.2,  0.02, 0.04, plusMat);
    plusV.position.set(-0.32, H + 0.58, 0);
    plusH.position.set(-0.32, H + 0.58, 0);
    group.add(plusV, plusH);

    // ── NEGATIVE terminal (right, larger ring) ──
    const negRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.09, 9, 18),
      new THREE.MeshLambertMaterial({ color: 0x888888 })
    );
    negRing.rotation.x = Math.PI / 2;
    negRing.position.set(0.32, H + 0.24, 0);
    group.add(negRing);

    // Blue disc — unmistakeable "−"
    const negDisc = cylinder(0.24, 0.04, 18,
      new THREE.MeshLambertMaterial({ color: 0x2244cc, emissive: 0x001040, emissiveIntensity: 0.3 }));
    negDisc.position.set(0.32, H + 0.08, 0);
    group.add(negDisc);

    // "−" symbol on negative disc
    const minusMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const minus = box(0.22, 0.02, 0.05, minusMat);
    minus.position.set(0.32, H + 0.12, 0);
    group.add(minus);

    // Floating "+" and "−" text plates above each terminal (large, flat)
    function addTerminalLabel(text, x, y, z, color) {
      const mat = new THREE.MeshLambertMaterial({ color });
      const m   = box(text === '+' ? 0.22 : 0.18, 0.01, 0.06, mat);
      m.position.set(x, y, z);
      group.add(m);
      if (text === '+') {
        const v = box(0.06, 0.01, 0.22, mat);
        v.position.set(x, y, z);
        group.add(v);
      }
    }

    group.position.set(wx, 0, wz);

    const pins = [
      new THREE.Vector3(wx - 0.32, H + 0.54, wz),  // pin 0 = + (positive)
      new THREE.Vector3(wx + 0.32, H + 0.24, wz),  // pin 1 = − (negative)
    ];
    return { group, pins };
  }

  // ─────────────────────────────────────────────────────────────
  //  GHOST PREVIEW
  //
  //  Builds a transparent local-space preview of a component.
  //  The group is centred at (0, 0, 0).  Caller sets .position
  //  and .rotation.y to move it on screen.
  //
  //  type:     'resistor' | 'led' | 'battery'
  //  span:     number of holes the component spans
  //  hs:       hole spacing (HOLE_SPACING from breadboard)
  //  rotation: 0 (horizontal) or 1 (vertical)
  // ─────────────────────────────────────────────────────────────
  function buildPreview(type, span, hs, rotation) {
    const group  = new THREE.Group();
    const alpha  = 0.45;
    const half   = (span * hs) / 2;

    if (type === 'resistor') {
      const LEAD_H = 0.72;
      const BODY_R = 0.10;
      const bodyLen = span * hs * 0.56;

      // leads
      const lMat = ghostMat(0xcccccc, alpha);
      [-half, half].forEach(offset => {
        const l = cylinder(0.022, LEAD_H, 7, lMat.clone());
        l.position.set(offset, LEAD_H / 2, 0);
        group.add(l);
      });

      // body
      const body = cylinder(BODY_R, bodyLen, 14, ghostMat(0xd4a96a, alpha));
      body.rotation.z = Math.PI / 2;
      body.position.y = LEAD_H;
      group.add(body);

      // bands
      const bw = bodyLen * 0.1;
      const bs = bodyLen / 5;
      for (let i = 0; i < 4; i++) {
        const b = cylinder(BODY_R + 0.004, bw, 12, ghostMat(BAND_COLORS[i], alpha));
        b.rotation.z = Math.PI / 2;
        b.position.set(-bodyLen / 2 + bs * (i + 1), LEAD_H, 0);
        group.add(b);
      }
    }

    if (type === 'led') {
      const CATHODE_H = 0.70, ANODE_H = 1.00;
      const lMat = ghostMat(0xcccccc, alpha);

      const cL = cylinder(0.023, CATHODE_H, 7, lMat.clone());
      cL.position.set(-half, CATHODE_H / 2, 0);
      group.add(cL);

      const aL = cylinder(0.023, ANODE_H, 7, lMat.clone());
      aL.position.set(half, ANODE_H / 2, 0);
      group.add(aL);

      const bodyY = (CATHODE_H + ANODE_H) / 2;
      const collar = cylinder(0.185, 0.11, 16, ghostMat(0x2a2a2a, alpha));
      collar.position.y = bodyY - 0.04;
      group.add(collar);

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.185, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.55),
        ghostMat(0xff2222, alpha * 0.85)
      );
      dome.position.y = bodyY + 0.04;
      group.add(dome);

      // "+" marker on anode side
      const pm = ghostMat(0xff3333, 0.8);
      [box(0.04, 0.01, 0.14, pm), box(0.14, 0.01, 0.04, pm.clone())].forEach(m => {
        m.position.set(half, 0.04, 0);
        group.add(m);
      });
      // "−" marker on cathode side
      const mm = box(0.12, 0.01, 0.04, ghostMat(0x3355ff, 0.8));
      mm.position.set(-half, 0.04, 0);
      group.add(mm);
    }

    if (type === 'battery') {
      const W = 2.0, H = 2.6, D = 1.4;
      const b = box(W, H, D, ghostMat(0x111111, alpha));
      b.position.y = H / 2;
      group.add(b);
      const lb = box(W, H * 0.55, D + 0.01, ghostMat(0x1a3a9a, alpha));
      lb.position.y = H * 0.52;
      group.add(lb);
    }

    // Apply rotation: 1 = rotate 90° around Y so component spans vertically
    if (rotation === 1) group.rotation.y = Math.PI / 2;

    return group;
  }

  // ── Exports ────────────────────────────────────────────────
  App.buildResistor = buildResistor;
  App.buildLED      = buildLED;
  App.buildBattery  = buildBattery;
  App.buildPreview  = buildPreview;

})(window.App = window.App || {});
