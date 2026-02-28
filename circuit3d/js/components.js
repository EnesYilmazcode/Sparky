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

    const LEAD_H   = 0.88;   // both leads same height
    const COLLAR_R = 0.185;
    const lMat = LEAD_MAT();

    // Both vertical leads — same height, no polarity distinction
    [[ax, az], [bx, bz]].forEach(([x, z]) => {
      const l = new THREE.Mesh(
        new THREE.CylinderGeometry(0.023, 0.023, LEAD_H, 7),
        lMat.clone()
      );
      l.position.set(x, LEAD_H / 2, z);
      group.add(l);
    });

    // Horizontal metal stubs from each lead top to the collar edge
    // (fills the gap so the dome doesn't float)
    const isHoriz = Math.abs(az - bz) < 0.01;
    if (isHoriz) {
      const catEdgeX = midX + Math.sign(ax - midX) * COLLAR_R;
      const anoEdgeX = midX + Math.sign(bx - midX) * COLLAR_R;
      const cLen = Math.abs(catEdgeX - ax);
      const aLen = Math.abs(anoEdgeX - bx);
      if (cLen > 0.01) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, cLen, 7), lMat.clone());
        s.rotation.z = Math.PI / 2;
        s.position.set((ax + catEdgeX) / 2, LEAD_H, az);
        group.add(s);
      }
      if (aLen > 0.01) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, aLen, 7), lMat.clone());
        s.rotation.z = Math.PI / 2;
        s.position.set((bx + anoEdgeX) / 2, LEAD_H, bz);
        group.add(s);
      }
    } else {
      const catEdgeZ = midZ + Math.sign(az - midZ) * COLLAR_R;
      const anoEdgeZ = midZ + Math.sign(bz - midZ) * COLLAR_R;
      const cLen = Math.abs(catEdgeZ - az);
      const aLen = Math.abs(anoEdgeZ - bz);
      if (cLen > 0.01) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, cLen, 7), lMat.clone());
        s.rotation.x = Math.PI / 2;
        s.position.set(ax, LEAD_H, (az + catEdgeZ) / 2);
        group.add(s);
      }
      if (aLen > 0.01) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, aLen, 7), lMat.clone());
        s.rotation.x = Math.PI / 2;
        s.position.set(bx, LEAD_H, (bz + anoEdgeZ) / 2);
        group.add(s);
      }
    }

    const bodyY = LEAD_H;

    // Collar
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(COLLAR_R, COLLAR_R, 0.11, 18),
      new THREE.MeshLambertMaterial({ color: 0x2a2a2a })
    );
    collar.position.set(midX, bodyY - 0.04, midZ);
    group.add(collar);

    // Flat cut on collar (pin-A side indicator)
    const catDir = new THREE.Vector3(ax - midX, 0, az - midZ).normalize();
    const cutBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.12, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
    );
    cutBox.position.set(midX + catDir.x * 0.14, bodyY - 0.04, midZ + catDir.z * 0.14);
    group.add(cutBox);

    // Dome
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(COLLAR_R, 22, 11, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshLambertMaterial({
        color, emissive: color, emissiveIntensity: 0.45, transparent: true, opacity: 0.88,
      })
    );
    dome.position.set(midX, bodyY + 0.04, midZ);
    dome.castShadow = true;
    group.add(dome);

    // Small +/− board-level markers so user can tell pin A from pin B
    const plusMat = new THREE.MeshLambertMaterial({ color: 0xff3333 });
    [box(0.04, 0.01, 0.14, plusMat), box(0.14, 0.01, 0.04, plusMat.clone())]
      .forEach(m => { m.position.set(bx, 0.03, bz); group.add(m); });
    const minus = box(0.12, 0.01, 0.04, new THREE.MeshLambertMaterial({ color: 0x3355ff }));
    minus.position.set(ax, 0.03, az);
    group.add(minus);

    const pins = [
      new THREE.Vector3(ax, 0, az),
      new THREE.Vector3(bx, 0, bz),
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

    // ── POSITIVE terminal (left) — entirely RED, unmistakeable ──
    // Red post
    const posCap = cylinder(0.13, 0.30, 14,
      new THREE.MeshLambertMaterial({ color: 0xff3333, emissive: 0x880000, emissiveIntensity: 0.5 }));
    posCap.position.set(-0.32, H + 0.37, 0);
    group.add(posCap);

    // Red top disc
    const posDisc = cylinder(0.19, 0.07, 16,
      new THREE.MeshLambertMaterial({ color: 0xff1111, emissive: 0xaa0000, emissiveIntensity: 0.6 }));
    posDisc.position.set(-0.32, H + 0.55, 0);
    group.add(posDisc);

    // Large "+" symbol on positive disc
    const plusMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const plusV = box(0.05, 0.025, 0.26, plusMat);
    const plusH = box(0.26, 0.025, 0.05, plusMat);
    plusV.position.set(-0.32, H + 0.60, 0);
    plusH.position.set(-0.32, H + 0.60, 0);
    group.add(plusV, plusH);

    // Glowing red ring around positive terminal base (halo)
    const posHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.04, 8, 20),
      new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xcc0000, emissiveIntensity: 0.9 })
    );
    posHalo.rotation.x = Math.PI / 2;
    posHalo.position.set(-0.32, H + 0.23, 0);
    group.add(posHalo);

    // ── NEGATIVE terminal (right) — entirely BLUE, unmistakeable ──
    // Blue platform base
    const negBase = cylinder(0.28, 0.10, 18,
      new THREE.MeshLambertMaterial({ color: 0x2244cc, emissive: 0x001166, emissiveIntensity: 0.4 }));
    negBase.position.set(0.32, H + 0.10, 0);
    group.add(negBase);

    // Blue torus ring
    const negRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.09, 9, 18),
      new THREE.MeshLambertMaterial({ color: 0x3366ff, emissive: 0x001188, emissiveIntensity: 0.5 })
    );
    negRing.rotation.x = Math.PI / 2;
    negRing.position.set(0.32, H + 0.24, 0);
    group.add(negRing);

    // Large "−" symbol on negative terminal
    const minusMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const minus = box(0.28, 0.025, 0.07, minusMat);
    minus.position.set(0.32, H + 0.14, 0);
    group.add(minus);

    // Glowing blue ring halo
    const negHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.04, 8, 20),
      new THREE.MeshLambertMaterial({ color: 0x2255ff, emissive: 0x0033cc, emissiveIntensity: 0.9 })
    );
    negHalo.rotation.x = Math.PI / 2;
    negHalo.position.set(0.32, H + 0.23, 0);
    group.add(negHalo);

    // ── Side-face +/− labels (front & back Z faces, clearly visible) ──
    // Put on both Z faces so the label is visible from any camera angle
    [D / 2 + 0.013, -(D / 2 + 0.013)].forEach(fz => {
      // "+" (red) — left half, same side as positive terminal
      const pMat = new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xaa0000, emissiveIntensity: 0.7 });
      const pV = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.46, 0.02), pMat);
      const pH = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.02), pMat);
      pV.position.set(-0.36, H * 0.48, fz);
      pH.position.set(-0.36, H * 0.48, fz);
      group.add(pV, pH);

      // "−" (blue) — right half, same side as negative terminal
      const nMat = new THREE.MeshLambertMaterial({ color: 0x2255ff, emissive: 0x1133cc, emissiveIntensity: 0.7 });
      const nH = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.02), nMat);
      nH.position.set(0.36, H * 0.48, fz);
      group.add(nH);
    });

    group.position.set(wx, 0, wz);

    const pins = [
      new THREE.Vector3(wx - 0.32, H + 0.54, wz),  // pin 0 = + (positive)
      new THREE.Vector3(wx + 0.32, H + 0.24, wz),  // pin 1 = − (negative)
    ];
    return { group, pins };
  }

  // ─────────────────────────────────────────────────────────────
  //  BUZZER
  //
  //  holeA / holeB: 2-hole footprint, same row.
  //  Cylinder body, dark gray, with "+" label on one side.
  // ─────────────────────────────────────────────────────────────
  function buildBuzzer(holeA, holeB) {
    const group = new THREE.Group();
    const ax = holeA.x, az = holeA.z;
    const bx = holeB.x, bz = holeB.z;
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    const LEAD_H = 0.70;

    // Vertical leads
    [[ax, az], [bx, bz]].forEach(([x, z]) => {
      const l = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, LEAD_H, 7),
        LEAD_MAT()
      );
      l.position.set(x, LEAD_H / 2, z);
      group.add(l);
    });

    // Main cylinder body
    const body = cylinder(0.28, 0.45, 18,
      new THREE.MeshLambertMaterial({ color: 0x222222 }));
    body.position.set(midX, LEAD_H + 0.225, midZ);
    body.castShadow = true;
    group.add(body);

    // Dark top disc (membrane)
    const top = cylinder(0.27, 0.06, 18,
      new THREE.MeshLambertMaterial({ color: 0x111111 }));
    top.position.set(midX, LEAD_H + 0.48, midZ);
    group.add(top);

    // "+" marker on positive lead side
    const pMat = new THREE.MeshLambertMaterial({ color: 0xff4444 });
    const pV = box(0.04, 0.01, 0.16, pMat);
    const pH = box(0.16, 0.01, 0.04, pMat.clone());
    pV.position.set(bx, 0.03, bz);
    pH.position.set(bx, 0.03, bz);
    group.add(pV, pH);

    // "−" on the other lead
    const mH = box(0.14, 0.01, 0.04,
      new THREE.MeshLambertMaterial({ color: 0x4466ff }));
    mH.position.set(ax, 0.03, az);
    group.add(mH);

    const pins = [
      new THREE.Vector3(ax, 0, az),
      new THREE.Vector3(bx, 0, bz),
    ];
    return { group, pins };
  }

  // ─────────────────────────────────────────────────────────────
  //  PUSH BUTTON
  //
  //  holeA / holeB: 2 holes (one per side of the button).
  //  Square body with a round off-white cap on top.
  // ─────────────────────────────────────────────────────────────
  function buildButton(holeA, holeB) {
    const group = new THREE.Group();
    const ax = holeA.x, az = holeA.z;
    const bx = holeB.x, bz = holeB.z;
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    const LEAD_H = 0.42;  // lead height — body sits right on top

    // Determine span direction to orient the connector rail correctly
    const dx = bx - ax, dz = bz - az;
    const spanLen = Math.sqrt(dx * dx + dz * dz);

    // Vertical leads going from board surface up to rail height
    [[ax, az], [bx, bz]].forEach(([x, z]) => {
      const l = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, LEAD_H, 8),
        LEAD_MAT()
      );
      l.position.set(x, LEAD_H / 2, z);
      group.add(l);
    });

    // Horizontal metal rail connecting both leads at top — the bridge bar
    // Oriented along the span direction using rotation
    const railGeo = new THREE.CylinderGeometry(0.025, 0.025, spanLen, 8);
    const rail    = new THREE.Mesh(railGeo, LEAD_MAT());
    // Rotate rail to lie horizontal along the span
    rail.rotation.z = Math.atan2(dz, dx) + Math.PI / 2;  // tilt 90° so axis aligns
    if (Math.abs(dz) > Math.abs(dx)) {
      // Primarily Z direction — rotate around X instead
      rail.rotation.z = 0;
      rail.rotation.x = Math.PI / 2;
    }
    rail.position.set(midX, LEAD_H, midZ);
    group.add(rail);

    // Square body sitting on the rail
    const body = box(0.50, 0.30, 0.50,
      new THREE.MeshLambertMaterial({ color: 0x2d6a2d }));
    body.position.set(midX, LEAD_H + 0.15, midZ);
    body.castShadow = true;
    group.add(body);

    // Cap stem (the white plastic column the cap sits on)
    const stem = cylinder(0.09, 0.10, 10,
      new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    stem.position.set(midX, LEAD_H + 0.36, midZ);
    group.add(stem);

    // Round cap on top — only presses down 0.07 units
    const cap = cylinder(0.19, 0.10, 18,
      new THREE.MeshLambertMaterial({ color: 0xe5e5e5 }));
    cap.position.set(midX, LEAD_H + 0.47, midZ);
    cap.userData.isButtonCap = true;
    cap.userData.capRestY    = LEAD_H + 0.47;
    cap.userData.capPressY   = LEAD_H + 0.40;   // only 0.07 down — subtle
    group.add(cap);

    // Thin ring at cap base
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.20, 0.022, 6, 18),
      new THREE.MeshLambertMaterial({ color: 0x999999 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(midX, LEAD_H + 0.42, midZ);
    group.add(ring);

    const pins = [
      new THREE.Vector3(ax, 0, az),
      new THREE.Vector3(bx, 0, bz),
    ];
    return { group, pins, capMesh: cap };
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
      const LEAD_H   = 0.88;
      const COLLAR_R = 0.185;
      const lMat = ghostMat(0xcccccc, alpha);

      // Both leads same height
      [[-half, 0], [half, 0]].forEach(([x, z]) => {
        const l = cylinder(0.023, LEAD_H, 7, lMat.clone());
        l.position.set(x, LEAD_H / 2, z);
        group.add(l);
      });

      // Horizontal stubs from lead tops to collar edge
      const stubLen = Math.max(0, half - COLLAR_R);
      if (stubLen > 0.01) {
        const sGeo = new THREE.CylinderGeometry(0.018, 0.018, stubLen, 7);
        const cStub = new THREE.Mesh(sGeo, lMat.clone());
        cStub.rotation.z = Math.PI / 2;
        cStub.position.set(-(half + COLLAR_R) / 2, LEAD_H, 0);
        group.add(cStub);
        const aStub = new THREE.Mesh(sGeo.clone(), lMat.clone());
        aStub.rotation.z = Math.PI / 2;
        aStub.position.set((half + COLLAR_R) / 2, LEAD_H, 0);
        group.add(aStub);
      }

      const bodyY = LEAD_H;
      const collar = cylinder(COLLAR_R, 0.11, 16, ghostMat(0x2a2a2a, alpha));
      collar.position.y = bodyY - 0.04;
      group.add(collar);

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(COLLAR_R, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.55),
        ghostMat(0xff2222, alpha * 0.85)
      );
      dome.position.y = bodyY + 0.04;
      group.add(dome);

      // +/− board-level markers
      const pm = ghostMat(0xff3333, 0.8);
      [box(0.04, 0.01, 0.14, pm), box(0.14, 0.01, 0.04, pm.clone())].forEach(m => {
        m.position.set(half, 0.04, 0);
        group.add(m);
      });
      const mm = box(0.12, 0.01, 0.04, ghostMat(0x3355ff, 0.8));
      mm.position.set(-half, 0.04, 0);
      group.add(mm);
    }

    if (type === 'buzzer') {
      const LEAD_H = 0.70;
      const lMat = ghostMat(0xcccccc, alpha);
      [-half, half].forEach(offset => {
        const l = cylinder(0.022, LEAD_H, 7, lMat.clone());
        l.position.set(offset, LEAD_H / 2, 0);
        group.add(l);
      });
      const body = cylinder(0.28, 0.45, 18, ghostMat(0x222222, alpha));
      body.position.set(0, LEAD_H + 0.225, 0);
      group.add(body);
      const top = cylinder(0.27, 0.06, 18, ghostMat(0x111111, alpha));
      top.position.set(0, LEAD_H + 0.48, 0);
      group.add(top);
    }

    if (type === 'button') {
      const LEAD_H = 0.55;
      const lMat = ghostMat(0xcccccc, alpha);
      [-half, half].forEach(offset => {
        const l = cylinder(0.022, LEAD_H, 7, lMat.clone());
        l.position.set(offset, LEAD_H / 2, 0);
        group.add(l);
      });
      const body = box(0.52, 0.28, 0.52, ghostMat(0x3a7a3a, alpha));
      body.position.set(0, LEAD_H + 0.14, 0);
      group.add(body);
      const cap = cylinder(0.18, 0.12, 18, ghostMat(0xe8e8e8, alpha));
      cap.position.set(0, LEAD_H + 0.34, 0);
      group.add(cap);
    }

    if (type === 'battery') {
      const W = 2.0, H = 2.6, D = 1.4;
      const ba = 0.80;  // battery ghost is much more opaque than other ghosts

      // Body
      const b = box(W, H, D, ghostMat(0x111111, ba));
      b.position.y = H / 2;
      group.add(b);

      // Label band
      const lb = box(W - 0.01, H * 0.55, D + 0.01, ghostMat(0x1a3a9a, ba));
      lb.position.y = H * 0.52;
      group.add(lb);

      // "9V" stripe
      const nv = box(0.6, 0.22, D + 0.02, ghostMat(0xffffff, ba * 0.7));
      nv.position.y = H * 0.52;
      group.add(nv);

      // Snap connector platform
      const snap = box(W * 0.65, 0.22, D * 0.55, ghostMat(0x333333, ba));
      snap.position.set(0, H + 0.11, 0);
      group.add(snap);

      // Positive terminal — red post + red disc + "+" symbol
      const posPost = cylinder(0.13, 0.30, 14, ghostMat(0xff3333, ba));
      posPost.position.set(-0.32, H + 0.37, 0);
      group.add(posPost);
      const posDisc = cylinder(0.19, 0.07, 16, ghostMat(0xff1111, ba));
      posDisc.position.set(-0.32, H + 0.55, 0);
      group.add(posDisc);
      const ppv = box(0.05, 0.025, 0.26, ghostMat(0xffffff, 0.95));
      const pph = box(0.26, 0.025, 0.05, ghostMat(0xffffff, 0.95));
      ppv.position.set(-0.32, H + 0.60, 0);
      pph.position.set(-0.32, H + 0.60, 0);
      group.add(ppv, pph);

      // Negative terminal — blue ring + "−" symbol
      const negBase = cylinder(0.28, 0.10, 18, ghostMat(0x2244cc, ba));
      negBase.position.set(0.32, H + 0.10, 0);
      group.add(negBase);
      const negRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.24, 0.09, 9, 18),
        ghostMat(0x3366ff, ba)
      );
      negRing.rotation.x = Math.PI / 2;
      negRing.position.set(0.32, H + 0.24, 0);
      group.add(negRing);
      const pminus = box(0.28, 0.025, 0.07, ghostMat(0xffffff, 0.95));
      pminus.position.set(0.32, H + 0.14, 0);
      group.add(pminus);

      // Side-face +/− labels (same as placed battery)
      [D / 2 + 0.013, -(D / 2 + 0.013)].forEach(fz => {
        const pMat = ghostMat(0xff2222, 0.95);
        const pV = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.46, 0.02), pMat);
        const pH = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.02), pMat.clone());
        pV.position.set(-0.36, H * 0.48, fz);
        pH.position.set(-0.36, H * 0.48, fz);
        group.add(pV, pH);
        const nH = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.02), ghostMat(0x2255ff, 0.95));
        nH.position.set(0.36, H * 0.48, fz);
        group.add(nH);
      });
    }

    // Apply rotation: 1 = rotate 90° around Y so component spans vertically
    if (rotation === 1) group.rotation.y = Math.PI / 2;

    return group;
  }

  // ── Exports ────────────────────────────────────────────────
  App.buildResistor = buildResistor;
  App.buildLED      = buildLED;
  App.buildBattery  = buildBattery;
  App.buildBuzzer   = buildBuzzer;
  App.buildButton   = buildButton;
  App.buildPreview  = buildPreview;

})(window.App = window.App || {});
