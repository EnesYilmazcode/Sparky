// ─────────────────────────────────────────────────────────────
//  components.js — 3D models of the parts, and the jumper wire
//
//  Scale: one hole pitch (0.1 in, 2.54 mm) is 0.4 world units, so a
//  unit is 6.35 mm. Parts are modelled close to that scale, except the
//  9V battery, which is shrunk so it does not dwarf the board.
//
//  Every builder takes hole objects ({x, z}) and returns
//  { group, pins }, where pins[i] is the world position of pin i.
//  Leads are bent tubes that end below the board surface, so a part
//  reads as plugged in rather than resting on top.
//
//  Exports: App.buildResistor, buildLED, buildBattery, buildBuzzer,
//           buildButton, buildWire, buildPreview, setHighlight,
//           componentValues, formatValue, ledHex, resistorBands
// ─────────────────────────────────────────────────────────────

(function (App) {

  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  // three r128 does no colour management: a hex colour is used as linear
  // light, so every authored sRGB colour has to be converted or it renders
  // washed out (red wires came out pink, black plastic grey).
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  App.lin = lin;
  const LED_VF = (window.BoardModel && window.BoardModel.LED_VF) ||
                 { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.2, white: 3.4 };

  // ─── Materials, shared by every part ─────────────────────────
  const MAT = {
    lead:    new THREE.MeshStandardMaterial({ color: lin(0xd9dce1), metalness: 1.0, roughness: 0.22 }),
    steel:   new THREE.MeshStandardMaterial({ color: lin(0xc3c7cd), metalness: 1.0, roughness: 0.36 }),
    brushed: new THREE.MeshStandardMaterial({ color: lin(0xaeb3ba), metalness: 1.0, roughness: 0.45 }),
    black:   new THREE.MeshPhysicalMaterial({ color: lin(0x111215), roughness: 0.38, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.35 }),
    matte:   new THREE.MeshStandardMaterial({ color: lin(0x1a1b1f), roughness: 0.85, metalness: 0 }),
    hole:    new THREE.MeshStandardMaterial({ color: lin(0x050506), roughness: 1.0 }),
    resBody: new THREE.MeshPhysicalMaterial({ color: lin(0xd5bd92), roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.45 }),
    white:   new THREE.MeshStandardMaterial({ color: lin(0xe9e9e6), roughness: 0.6 }),
  };
  Object.values(MAT).forEach(m => { m.userData.shared = true; });

  // Resistor colour code, digit order.
  const BAND_HEX = [0x151515, 0x6e3a1e, 0xc62828, 0xef7b24, 0xf4c430, 0x2e8b3e, 0x2459b8, 0x7b3fa0, 0x8d9096, 0xf3f3f1];
  const GOLD = 'gold', SILVER = 'silver';
  const _bandMats = new Map();
  function bandMat(key) {
    if (_bandMats.has(key)) return _bandMats.get(key);
    let m;
    if (key === GOLD)        m = new THREE.MeshStandardMaterial({ color: lin(0xd4a93a), metalness: 0.85, roughness: 0.32 });
    else if (key === SILVER) m = new THREE.MeshStandardMaterial({ color: lin(0xc8ccd2), metalness: 0.9, roughness: 0.3 });
    else                     m = new THREE.MeshPhysicalMaterial({ color: lin(key), roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.45 });
    m.userData.shared = true;
    _bandMats.set(key, m);
    return m;
  }

  // ─── Electrical values ───────────────────────────────────────
  //  The defaults live in simulate.js, the one module that loads outside the
  //  browser, so there is exactly one table. A component copies them at
  //  placement time and carries its own values from then on.

  function defaultValues(type) {
    const base = (App.PROPS && App.PROPS[type]) || {};
    return type === 'led' ? Object.assign({ color: 'red' }, base) : Object.assign({}, base);
  }

  function defaultResistance() { return defaultValues('resistor').resistance || 470; }

  const LED_HEX = { red: 0xff2a1f, yellow: 0xffc21a, green: 0x2ee05a, blue: 0x2f7bff, white: 0xf4f7ff };
  function ledHex(color) { return LED_HEX[color] || LED_HEX.red; }

  function componentValues(type, overrides) {
    const v = Object.assign(defaultValues(type), overrides || {});
    if (type === 'led') {
      if (!LED_HEX[v.color]) v.color = 'red';
      if (!(overrides && overrides.forwardVoltage != null)) v.forwardVoltage = LED_VF[v.color];
    }
    return v;
  }

  function formatOhms(r) {
    if (!(r > 0)) return '0 Ω';
    if (r >= 1e6) return +(r / 1e6).toFixed(2) + ' MΩ';
    if (r >= 1e3) return +(r / 1e3).toFixed(2) + ' kΩ';
    return r + ' Ω';
  }

  function formatValue(comp) {
    const v = comp.values || componentValues(comp.type);
    if (comp.type === 'resistor' || comp.type === 'buzzer') return formatOhms(v.resistance);
    if (comp.type === 'battery') return v.voltage + ' V';
    if (comp.type === 'led') return (v.color || 'red') + ', ' + v.forwardVoltage.toFixed(1) + ' V forward';
    return '';
  }

  // 470 Ω → yellow, violet, brown, gold
  function resistorBands(ohms) {
    let sig = Number(ohms), exp = 0;
    if (!(sig > 0)) return [BAND_HEX[0], BAND_HEX[0], BAND_HEX[0], GOLD];
    while (sig >= 100) { sig /= 10; exp++; }
    while (sig < 10)   { sig *= 10; exp--; }
    sig = Math.round(sig);
    if (sig === 100) { sig = 10; exp++; }
    const mult = exp === -1 ? GOLD : exp === -2 ? SILVER : (BAND_HEX[exp] ?? BAND_HEX[0]);
    return [BAND_HEX[Math.floor(sig / 10)], BAND_HEX[sig % 10], mult, GOLD];
  }

  // ─── Geometry helpers ────────────────────────────────────────

  // A polyline with rounded corners, as a curve a tube can follow.
  function roundedPath(points, radius) {
    const path = new THREE.CurvePath();
    let prev = points[0].clone();
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const d1 = b.clone().sub(a), l1 = d1.length();
      const d2 = c.clone().sub(b), l2 = d2.length();
      if (l1 < 1e-5 || l2 < 1e-5) continue;
      d1.divideScalar(l1); d2.divideScalar(l2);
      const r = Math.min(radius, l1 / 2, l2 / 2);
      const p1 = b.clone().addScaledVector(d1, -r);
      const p2 = b.clone().addScaledVector(d2, r);
      if (prev.distanceTo(p1) > 1e-4) path.add(new THREE.LineCurve3(prev, p1));
      path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
      prev = p2;
    }
    const last = points[points.length - 1].clone();
    if (prev.distanceTo(last) > 1e-4) path.add(new THREE.LineCurve3(prev, last));
    return path;
  }

  function wire(points, radius, mat, bend) {
    const path = roundedPath(points, bend == null ? 0.07 : bend);
    const len = path.getLength();
    const geo = new THREE.TubeGeometry(path, Math.max(6, Math.ceil(len * 30)), radius, 8, false);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  }

  function lathe(profile, mat, segs) {
    const m = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs || 40), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // Local frame for a two-lead part: origin midway between the holes,
  // +x from hole A to hole B, y up.
  function frame(holeA, holeB) {
    const A = V3(holeA.x, 0, holeA.z), B = V3(holeB.x, 0, holeB.z);
    const d = B.clone().sub(A);
    const span = d.length();
    d.normalize();
    const g = new THREE.Group();
    g.position.copy(A.clone().add(B).multiplyScalar(0.5));
    g.rotation.y = Math.atan2(-d.z, d.x);
    return { group: g, span, A, B };
  }

  // A lead that leaves a part at `from` (local), bends, and drops into
  // the hole at local x = hx.
  function leadTo(from, hx, radius, bendY) {
    const y = bendY == null ? from.y : bendY;
    const pts = [from.clone()];
    if (Math.abs(from.x - hx) > 0.02) {
      if (Math.abs(y - from.y) > 0.01) pts.push(V3(from.x, y, 0));
      pts.push(V3(hx, y, 0));
    }
    pts.push(V3(hx, -0.22, 0));
    return wire(pts, radius, MAT.lead, 0.06);
  }

  // ─────────────────────────────────────────────────────────────
  //  RESISTOR — a quarter-watt carbon film part
  //
  //  Lies flat when the holes are far enough apart, the way you bend
  //  one into a breadboard. Two holes close together get the upright
  //  hairpin mount instead.
  // ─────────────────────────────────────────────────────────────
  function resistorProfile(L, R) {
    const h = L / 2, n = R * 0.84;
    const cap = [];
    for (let i = 0; i <= 6; i++) {             // rounded end cap
      const a = (i / 6) * Math.PI / 2;
      cap.push([R * Math.sin(a) * 0.98, -h + (R * 0.55) * (1 - Math.cos(a))]);
    }
    const body = [[R, -h + 0.18], [n, -h + 0.28], [n, h - 0.28], [R, h - 0.18]];
    const top = cap.slice().reverse().map(([r, y]) => [r, -y]);
    return cap.concat(body, top);
  }

  function radiusAt(profile, y) {
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
      if ((y - y0) * (y - y1) <= 0 && y1 !== y0) return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
    }
    return profile[Math.floor(profile.length / 2)][0];
  }

  function resistorBody(L, R, resistance) {
    const g = new THREE.Group();
    const prof = resistorProfile(L, R);
    g.add(lathe(prof, MAT.resBody, 40));
    const bands = resistorBands(resistance ?? defaultResistance());
    const at = [0.2, 0.32, 0.44, 0.78];
    const w = L * 0.075;
    bands.forEach((key, i) => {
      const y = -L / 2 + L * at[i];
      const r = radiusAt(prof, y) + 0.004;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 40, 1, true), bandMat(key));
      band.position.y = y;
      band.castShadow = true;
      g.add(band);
    });
    return g;
  }

  function buildResistor(holeA, holeB, resistance) {
    const { group, span } = frame(holeA, holeB);
    const R = 0.17, LR = 0.026;

    if (span >= 1.15) {
      const L = Math.min(1.02, Math.max(0.6, span - 0.5));
      const Y = R + 0.08;
      const body = resistorBody(L, R, resistance);
      body.rotation.z = -Math.PI / 2;                    // lathe axis onto +x
      body.position.y = Y;
      group.add(body);
      group.add(leadTo(V3(-L / 2 + 0.03, Y, 0), -span / 2, LR));
      group.add(leadTo(V3( L / 2 - 0.03, Y, 0),  span / 2, LR));
    } else {
      // hairpin: body stands over hole A, lead B loops over the top
      const L = 0.9, base = 0.16;
      const body = resistorBody(L, R, resistance);
      body.position.set(-span / 2, base + L / 2, 0);
      group.add(body);
      group.add(wire([V3(-span / 2, base + 0.03, 0), V3(-span / 2, -0.22, 0)], LR, MAT.lead));
      const topY = base + L + 0.14;
      group.add(wire([V3(-span / 2, base + L - 0.03, 0), V3(-span / 2, topY, 0), V3(span / 2, topY, 0), V3(span / 2, -0.22, 0)], LR, MAT.lead, 0.12));
    }

    group.updateMatrixWorld(true);
    return { group, pins: [V3(holeA.x, 0, holeA.z), V3(holeB.x, 0, holeB.z)] };
  }

  // ─────────────────────────────────────────────────────────────
  //  LED — 5 mm, water-clear-tinted epoxy with the lead frame inside
  //
  //  pin 0 = CATHODE (−), the side with the flat on the flange.
  //  pin 1 = ANODE (+).
  // ─────────────────────────────────────────────────────────────
  let _glowTex = null;
  function glowTexture() {
    if (_glowTex) return _glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    r.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    _glowTex = new THREE.CanvasTexture(c);
    return _glowTex;
  }

  function flangeGeometry(R, flat, h) {
    const a = Math.acos(flat / R);
    const s = new THREE.Shape();
    s.absarc(0, 0, R, -(Math.PI - a), Math.PI - a, false);
    s.lineTo(-flat, -R * Math.sin(a));
    const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 40 });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }

  function buildLED(holeA, holeB, color) {
    const colorName = typeof color === 'string' ? color : 'red';
    const hex = typeof color === 'number' ? color : ledHex(colorName);
    const { group, span } = frame(holeA, holeB);   // −x = cathode, +x = anode
    const RB = 0.39, FL = 0.43, Y0 = 0.36;          // body radius, flange radius, flange bottom

    // epoxy: its own material so each LED can light independently
    // Unlit, the epoxy is a deep tint; lit, it glows with the die's colour.
    // It skips tone mapping so a lit red stays red instead of going orange.
    const tint = colorName === 'white' ? lin(0xdfe9ff) : lin(hex).multiplyScalar(0.6);
    const epoxy = new THREE.MeshPhysicalMaterial({
      color: tint, emissive: lin(hex), emissiveIntensity: 0,
      roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
      transparent: true, opacity: 0.82, depthWrite: false, toneMapped: false,
    });

    const flange = new THREE.Mesh(flangeGeometry(FL, 0.35, 0.08), epoxy);
    flange.position.y = Y0;
    group.add(flange);

    const top = Y0 + 0.09 + 0.52;
    const prof = [[0, Y0 + 0.09], [RB - 0.02, Y0 + 0.09], [RB, Y0 + 0.1], [RB, top]];
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI / 2;
      prof.push([RB * Math.cos(a), top + RB * Math.sin(a)]);
    }
    const dome = lathe(prof, epoxy, 48);
    dome.castShadow = false;
    group.add(dome);

    // lead frame: the anvil and reflector cup on the cathode, the post on the anode
    const frameY = Y0 + 0.08;
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 0.035), MAT.steel);
    anvil.position.set(-0.12, frameY + 0.2, 0);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.05, 0.06, 20), MAT.steel);
    cup.position.set(-0.09, frameY + 0.41, 0);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.03), MAT.steel);
    post.position.set(0.14, frameY + 0.17, 0);
    const bond = wire([V3(0.14, frameY + 0.34, 0), V3(0.05, frameY + 0.52, 0), V3(-0.08, frameY + 0.45, 0)], 0.006, MAT.lead, 0.05);
    group.add(anvil, cup, post, bond);

    // leads: 2.54 mm apart under the body, bent out to whatever span was asked for
    const LR = 0.026;
    group.add(leadTo(V3(-0.2, frameY + 0.02, 0), -span / 2, LR, 0.16));
    group.add(leadTo(V3( 0.2, frameY + 0.02, 0),  span / 2, LR, 0.16));

    // lit state: the die's hot spot, a warm pool of light, and a halo
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: lin(hex).lerp(new THREE.Color(1, 1, 1), 0.45), transparent: true,
      depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, opacity: 0,
    }));
    core.position.set(-0.04, frameY + 0.44, 0);
    core.scale.set(1.1, 1.1, 1);
    core.renderOrder = 2;
    core.visible = false;
    group.add(core);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: lin(hex), transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, opacity: 0,
    }));
    glow.position.set(0, top + 0.1, 0);
    glow.scale.set(3.2, 3.2, 1);
    glow.renderOrder = 2;
    glow.visible = false;
    group.add(glow);

    // The light exists from the start at zero intensity: adding and removing
    // lights changes the light count, and every material recompiles its
    // shader, which stalled the first frame of every simulation run.
    const light = new THREE.PointLight(lin(hex), 0, 5, 2);
    light.position.set(0, top, 0);
    group.add(light);
    group.userData.setLit = function (on, level) {
      const k = Math.max(0.35, Math.min(1.4, level == null ? 1 : level));
      epoxy.emissiveIntensity = on ? 0.9 * k : 0;
      epoxy.opacity = on ? 0.9 : 0.82;
      core.visible = glow.visible = on;
      core.material.opacity = on ? Math.min(1, 0.95 * k) : 0;
      glow.material.opacity = on ? 0.5 * k : 0;
      light.intensity = on ? 1.6 * k : 0;
    };
    group.userData.epoxy = epoxy;

    group.updateMatrixWorld(true);
    return { group, pins: [V3(holeA.x, 0, holeA.z), V3(holeB.x, 0, holeB.z)] };
  }

  // ─────────────────────────────────────────────────────────────
  //  BATTERY — 9 V, standing beside the board
  //
  //  pin 0 = positive (+), the small round stud.
  //  pin 1 = negative (−), the hexagonal socket.
  // ─────────────────────────────────────────────────────────────
  let _labelTex = null;
  function batteryLabel() {
    if (_labelTex) return _labelTex;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#161a22';
    g.fillRect(0, 0, 512, 1024);
    const band = g.createLinearGradient(0, 360, 0, 700);
    band.addColorStop(0, '#f7a21b'); band.addColorStop(1, '#e8850c');
    g.fillStyle = band;
    g.fillRect(0, 360, 512, 340);
    g.fillStyle = '#161a22';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 250px Inter, "Segoe UI", Arial, sans-serif';
    g.fillText('9V', 256, 540);
    g.fillStyle = '#f2f2f0';
    g.font = '700 56px Inter, "Segoe UI", Arial, sans-serif';
    g.fillText('SPARKY', 256, 190);
    g.font = '600 34px Inter, "Segoe UI", Arial, sans-serif';
    g.fillStyle = 'rgba(242,242,240,0.7)';
    g.fillText('ALKALINE', 256, 250);
    g.font = '700 70px Inter, "Segoe UI", Arial, sans-serif';
    g.fillStyle = '#f2f2f0';
    g.fillText('+', 150, 850);
    g.fillText('−', 362, 850);
    _labelTex = new THREE.CanvasTexture(c);
    _labelTex.encoding = THREE.sRGBEncoding;
    _labelTex.anisotropy = 8;
    return _labelTex;
  }

  function roundedRectShape(w, d, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  const BAT = { W: 2.6, D: 1.7, H: 4.3, TERM: 0.62 };
  App.BATTERY_DIMS = BAT;

  // Terminal tops of a battery standing at (wx, wz): [+, −].
  function batteryPinsAt(wx, wz) {
    const topY = BAT.H - 0.04;
    return [V3(wx - BAT.TERM, topY + 0.38, wz), V3(wx + BAT.TERM, topY + 0.3, wz)];
  }
  App.batteryPinsAt = batteryPinsAt;

  function buildBattery(wx, wz) {
    const group = new THREE.Group();
    const { W, D, H, TERM } = BAT;

    const casing = new THREE.MeshPhysicalMaterial({ color: lin(0x161a22), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const bodyGeo = new THREE.ExtrudeGeometry(roundedRectShape(W, D, 0.26), {
      depth: H - 0.36, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10,
    });
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.translate(0, 0.05, 0);
    const body = new THREE.Mesh(bodyGeo, casing);
    body.castShadow = body.receiveShadow = true;
    group.add(body);

    // printed label on both wide faces
    const labelMat = new THREE.MeshPhysicalMaterial({ map: batteryLabel(), roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.46, H - 0.62), labelMat);
      p.position.set(0, (H - 0.36) / 2 + 0.05, s * (D / 2 + 0.051));
      if (s < 0) p.rotation.y = Math.PI;
      group.add(p);
    }

    // crimped steel top
    const capGeo = new THREE.ExtrudeGeometry(roundedRectShape(W - 0.04, D - 0.04, 0.24), {
      depth: 0.22, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3, curveSegments: 10,
    });
    capGeo.rotateX(-Math.PI / 2);
    capGeo.translate(0, H - 0.3, 0);
    const cap = new THREE.Mesh(capGeo, MAT.brushed);
    cap.castShadow = true;
    group.add(cap);
    const topY = H - 0.3 + 0.26;

    // positive: small round stud
    const pos = new THREE.Group();
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.3, 32), MAT.steel);
    stud.position.y = 0.15;
    const studTop = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.08, 32), MAT.steel);
    studTop.position.y = 0.33;
    pos.add(stud, studTop);
    pos.position.set(-TERM, topY, 0);
    group.add(pos);

    // negative: hexagonal socket
    const hex = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = Math.cos(a) * 0.36, py = Math.sin(a) * 0.36;
      if (i === 0) hex.moveTo(px, py); else hex.lineTo(px, py);
    }
    hex.closePath();
    const bore = new THREE.Path();
    bore.absarc(0, 0, 0.2, 0, Math.PI * 2, true);
    hex.holes.push(bore);
    const socketGeo = new THREE.ExtrudeGeometry(hex, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
    socketGeo.rotateX(-Math.PI / 2);
    const socket = new THREE.Mesh(socketGeo, MAT.steel);
    socket.position.set(TERM, topY, 0);
    socket.castShadow = true;
    const socketFloor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24), MAT.matte);
    socketFloor.position.set(TERM, topY + 0.04, 0);
    group.add(socket, socketFloor);

    // small polarity rings, printed on the cap
    const ring = (x, c) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 40), new THREE.MeshBasicMaterial({ color: lin(c), toneMapped: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, topY + 0.003, 0);
      return m;
    };
    group.add(ring(-TERM, 0xe53935), ring(TERM, 0x3a6ff0));

    group.position.set(wx, 0, wz);
    group.updateMatrixWorld(true);

    return { group, pins: batteryPinsAt(wx, wz) };   // pin 0 = +, pin 1 = −
  }

  // ─────────────────────────────────────────────────────────────
  //  BUZZER — 12 mm active piezo buzzer
  //  pin 1 (hole B) is +, marked on the top.
  // ─────────────────────────────────────────────────────────────
  function buildBuzzer(holeA, holeB) {
    const { group, span } = frame(holeA, holeB);
    const R = 0.5, B = 0.06, H = 0.62;

    const shell = lathe([
      [0, B], [R - 0.03, B], [R, B + 0.03], [R, B + H - 0.06], [R - 0.03, B + H - 0.01],
      [R - 0.08, B + H], [0.16, B + H], [0.14, B + H - 0.04], [0.12, B + H - 0.2], [0, B + H - 0.2],
    ], MAT.black, 48);
    group.add(shell);

    // sound port
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.01, 24), MAT.hole);
    port.position.y = B + H - 0.19;
    group.add(port);

    // + moulded next to the positive lead
    const plus = new THREE.Group();
    const bar = (w, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), MAT.white); plus.add(m); };
    bar(0.16, 0.035); bar(0.035, 0.16);
    plus.position.set(0.3, B + H + 0.005, 0.08);
    group.add(plus);

    const LR = 0.026;
    group.add(leadTo(V3(-0.2, B + 0.02, 0), -span / 2, LR, 0.04));
    group.add(leadTo(V3( 0.2, B + 0.02, 0),  span / 2, LR, 0.04));

    // buzzing: a fast, tiny shake while it sounds
    group.userData.setActive = function (on) {
      if (on && !group.userData._buzz) {
        const base = shell.position.clone();
        group.userData._buzz = t => {
          const k = 0.012;
          shell.position.set(base.x + Math.sin(t * 91) * k, base.y, base.z + Math.cos(t * 83) * k);
          plus.position.x = 0.3 + Math.sin(t * 91) * k;
        };
        App.addTicker?.(group.userData._buzz);
      } else if (!on && group.userData._buzz) {
        App.removeTicker?.(group.userData._buzz);
        group.userData._buzz = null;
        shell.position.set(0, 0, 0);
        plus.position.x = 0.3;
      }
    };

    group.updateMatrixWorld(true);
    return { group, pins: [V3(holeA.x, 0, holeA.z), V3(holeB.x, 0, holeB.z)] };
  }

  // ─────────────────────────────────────────────────────────────
  //  PUSH BUTTON — 6 mm tactile switch
  // ─────────────────────────────────────────────────────────────
  function buildButton(holeA, holeB) {
    const { group, span } = frame(holeA, holeB);
    const S = 0.92, B = 0.05, BH = 0.34;

    const base = new THREE.Mesh(new THREE.BoxGeometry(S, BH, S), MAT.black);
    base.position.y = B + BH / 2;
    base.castShadow = base.receiveShadow = true;
    group.add(base);

    // steel cover with the four corner nubs
    const plateY = B + BH + 0.02;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(S + 0.02, 0.035, S + 0.02), MAT.steel);
    plate.position.y = plateY;
    plate.castShadow = true;
    group.add(plate);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16), MAT.matte);
      n.position.set(sx * 0.33, plateY + 0.03, sz * 0.33);
      group.add(n);
    }
    // side tabs of the cover, folded down
    for (const sz of [-1, 1]) {
      const tab = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.03), MAT.steel);
      tab.position.set(0, plateY - 0.1, sz * (S / 2 + 0.02));
      group.add(tab);
    }

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 32), MAT.matte);
    collar.position.y = plateY + 0.03;
    group.add(collar);

    const capRestY = plateY + 0.16;
    const capMat = new THREE.MeshPhysicalMaterial({ color: lin(0x2b2e35), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.26, 0.24, 36), capMat);
    cap.position.y = capRestY;
    cap.castShadow = true;
    cap.userData.isButtonCap = true;
    cap.userData.capRestY    = capRestY;
    cap.userData.capPressY   = capRestY - 0.09;
    cap.userData.restColor   = 0x2b2e35;
    group.add(cap);

    // flat legs out of the sides, bent down into the holes
    const LR = 0.03;
    group.add(leadTo(V3(-S / 2 + 0.02, B + 0.12, 0), -span / 2, LR, B + 0.12));
    group.add(leadTo(V3( S / 2 - 0.02, B + 0.12, 0),  span / 2, LR, B + 0.12));

    group.updateMatrixWorld(true);
    return { group, pins: [V3(holeA.x, 0, holeA.z), V3(holeB.x, 0, holeB.z)], capMesh: cap };
  }

  // ─────────────────────────────────────────────────────────────
  //  JUMPER WIRE
  //
  //  Board ends plug in straight down: insulation stops just above the
  //  surface and a bare tinned tip goes into the hole. Ends on a battery
  //  terminal come down onto it from above.
  // ─────────────────────────────────────────────────────────────
  const _insul = new Map();
  function insulation(hex) {
    if (_insul.has(hex)) return _insul.get(hex);
    const m = new THREE.MeshPhysicalMaterial({ color: lin(hex), roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.5, envMapIntensity: 0.6 });
    m.userData.shared = true;
    _insul.set(hex, m);
    return m;
  }

  function buildWire(start, end, hex, opts) {
    const g = new THREE.Group();
    const mat = (opts && opts.material) || insulation(hex);
    const R = 0.05;
    const sBoard = start.y < 0.15, eBoard = end.y < 0.15;
    const s0 = V3(start.x, sBoard ? 0.18 : start.y + 0.06, start.z);
    const e0 = V3(end.x,   eBoard ? 0.18 : end.y + 0.06,   end.z);
    const flat = Math.hypot(end.x - start.x, end.z - start.z);
    const lift = 0.3 + Math.min(flat * 0.16, 2.2);
    const top = Math.max(s0.y, e0.y) + lift;
    const toward = V3(end.x - start.x, 0, end.z - start.z).normalize().multiplyScalar(Math.min(0.35, flat * 0.2));
    const curve = new THREE.CubicBezierCurve3(
      s0,
      V3(s0.x + toward.x, top, s0.z + toward.z),
      V3(e0.x - toward.x, top, e0.z - toward.z),
      e0,
    );
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, R, 10, false), mat);
    tube.castShadow = true;
    g.add(tube);

    for (const [p, onBoard, p0] of [[start, sBoard, s0], [end, eBoard, e0]]) {
      if (onBoard) {
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(R, R, p0.y - 0.05, 12), mat);
        sleeve.position.set(p.x, (p0.y + 0.05) / 2, p.z);
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 10), MAT.lead);
        tip.position.set(p.x, -0.1, p.z);
        g.add(sleeve, tip);
      } else {
        const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 16), MAT.steel);
        lug.position.set(p.x, p.y + 0.02, p.z);
        g.add(lug);
      }
    }
    return g;
  }

  // ─────────────────────────────────────────────────────────────
  //  Ghosts and highlight
  // ─────────────────────────────────────────────────────────────
  const GHOST = {
    ok:  new THREE.MeshStandardMaterial({ color: lin(0x5aa9ff), transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.4, emissive: lin(0x1d4ed8), emissiveIntensity: 0.25 }),
    bad: new THREE.MeshStandardMaterial({ color: lin(0xff6b6b), transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.4, emissive: lin(0xb91c1c), emissiveIntensity: 0.25 }),
  };

  function ghostify(group, ok) {
    const drop = [];
    group.traverse(o => {
      if (o.isLight || o.isSprite) drop.push(o);
      if (!o.isMesh) return;
      o.material = ok === false ? GHOST.bad : GHOST.ok;
      o.castShadow = o.receiveShadow = false;
      o.renderOrder = 2;
    });
    drop.forEach(o => o.parent && o.parent.remove(o));
    group.userData.setLit = null;
    return group;
  }

  // A ghost of the real part at the real holes, so a preview can never
  // disagree with what gets placed.
  function buildPreview(type, holeA, holeB, ok, values) {
    let built = null;
    const v = values || {};
    if (type === 'resistor') built = buildResistor(holeA, holeB, v.resistance);
    if (type === 'led')      built = buildLED(holeA, holeB, v.color || 'red');
    if (type === 'buzzer')   built = buildBuzzer(holeA, holeB);
    if (type === 'button')   built = buildButton(holeA, holeB);
    if (type === 'battery')  built = buildBattery(0, 0);
    if (!built) return null;
    return ghostify(built.group, ok);
  }

  function disposeGroup(group) {
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.material.userData?.shared && o.material !== GHOST.ok && o.material !== GHOST.bad) o.material.dispose?.();
    });
  }

  // Selection: swap each mesh to a tinted copy of its material, and back.
  function setHighlight(group, on, tint) {
    group.traverse(o => {
      if (!o.isMesh) return;
      if (on) {
        if (o.userData._baseMat) return;
        o.userData._baseMat = o.material;
        const m = o.material.clone();
        if (m.emissive) { m.emissive.copy(lin(tint ?? 0x3b82f6)); m.emissiveIntensity = tint ? 0.9 : 1.0; }
        if (tint) { m.transparent = true; m.opacity = Math.min(m.opacity, 0.55); }
        o.material = m;
      } else if (o.userData._baseMat) {
        o.material.dispose();
        o.material = o.userData._baseMat;
        delete o.userData._baseMat;
      }
    });
  }

  // ── Exports ────────────────────────────────────────────────
  App.buildResistor = buildResistor;
  App.buildLED      = buildLED;
  App.buildBattery  = buildBattery;
  App.buildBuzzer   = buildBuzzer;
  App.buildButton   = buildButton;
  App.buildWire     = buildWire;
  App.buildPreview  = buildPreview;
  App.ghostify      = ghostify;
  App.disposeGroup  = disposeGroup;
  App.setHighlight  = setHighlight;

  App.componentValues = componentValues;
  App.formatValue     = formatValue;
  App.ledHex          = ledHex;
  App.resistorBands   = resistorBands;

})(window.App = window.App || {});
