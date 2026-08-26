// ─────────────────────────────────────────────────────────────
//  simulate.js — Circuit simulation engine
//
//  NODE MODEL
//  ──────────
//  Each breadboard hole belongs to a "node" determined by its
//  physical connectivity (columns in same half share a node):
//
//    bb_top_<col>  →  any hole in col <col>, rows a–e
//    bb_bot_<col>  →  any hole in col <col>, rows f–j
//    bb_rail_tp    →  all holes in the top + rail row    (positive)
//    bb_rail_tn    →  all holes in the top − rail row    (negative)
//    bb_rail_bn    →  all holes in the bottom + rail row (positive)
//    bb_rail_bp    →  all holes in the bottom − rail row (negative)
//
//  Wires (drawn by the user) additionally merge any two nodes.
//
//  POLARITY
//  ────────
//  LEDs are diodes — current may only flow from anode (+) to cathode (−).
//  That is not a special case here: the LED is stamped into the solver
//  as a diode, so a backwards one blocks its branch on its own.
//  Battery: pin 0 = positive (+) output, pin 1 = negative (−) return.
//
//  SOLVER
//  ──────
//  buildGraph resolves the board into electrical nodes, buildNetlist
//  turns those into elements, and mna.js solves Kirchhoff's Current Law
//  at every node at once. The previous engine walked each battery-to-
//  battery path and evaluated it in isolation, which double counted any
//  element two branches shared and had no node voltages at all.
//
//  EXPORTS
//  ───────
//  Browser: window.App.runSimulation() / App.stopSimulation(), unchanged.
//  Node:    module.exports = the pure solver (PROPS, buildGraph,
//           buildNetlist, analyze) so a test runner can call it.
//  Everything above the "Presentation" divider is pure: no document,
//  no THREE, no AudioContext.
// ─────────────────────────────────────────────────────────────

(function (root, factory) {
  // The solver is a separate module so it can be tested on its own.
  // Node resolves it by path; the browser gets it from the script tag
  // that must load mna.js before this file.
  const MNA = (typeof require === 'function') ? require('./mna.js')
                                              : (root && root.MNA);
  const Sim = factory(MNA);
  if (typeof module === 'object' && module.exports) module.exports = Sim;
  if (root) Sim.install(root.App = root.App || {});
})(typeof window !== 'undefined' ? window : null, function (MNA) {

  // Browser App namespace, set by install(). Stays null under node.
  let App = null;

  // ── Electrical properties ───────────────────────────────────
  const PROPS = {
    battery:  { voltage: 9.0 },
    resistor: { resistance: 470 },    // about 15 mA on 9 V through an LED
    led:      { forwardVoltage: 2.0, thresholdCurrent: 0.001, maxCurrent: 0.020 },
    buzzer:   { resistance: 42,      thresholdCurrent: 0.001 },
  };

  // A placed component carries its own values. PROPS is the default for parts
  // built before instance values existed, and is what keeps this module
  // loadable without a browser.
  function propsOf(comp) {
    return comp.values || PROPS[comp.type] || {};
  }

  const STOCK_R = [100, 150, 220, 330, 470, 680, 1000, 1500, 2200, 3300, 4700, 10000];

  function stockResistor(minOhms) {
    return STOCK_R.find(r => r >= minOhms) || Math.ceil(minOhms / 1000) * 1000;
  }

  function overCurrentLine(comp, I, netV) {
    const max = propsOf(comp).maxCurrent;
    if (!max || I <= max) return null;
    const minR = Math.ceil(netV / max);
    return {
      text: "  " + comp.type.toUpperCase() + " is over its " + (max * 1000).toFixed(0) +
            " mA rating at " + (I * 1000).toFixed(1) + " mA. Needs at least " + minR +
            " ohm in series, so use " + stockResistor(minR) + " ohm.",
      cls: "sim-err",
    };
  }

  // app.js places LEDs pin 0 = cathode, pin 1 = anode.
  const LED_ANODE_PIN = 1;

  // A short is now a measured current, not "this path has no resistor".
  const SHORT_CIRCUIT_A = 1.0;     // amps out of the supply
  const OPEN_CIRCUIT_A  = 1e-6;    // below this the circuit is open

  // ── Union-Find ──────────────────────────────────────────────
  class UnionFind {
    constructor() { this._p = {}; }
    make(id) { if (!(id in this._p)) this._p[id] = id; }
    find(id) {
      this.make(id);
      if (this._p[id] !== id) this._p[id] = this.find(this._p[id]);
      return this._p[id];
    }
    union(a, b) {
      const ra = this.find(a), rb = this.find(b);
      if (ra === rb) return;
      // Smaller id always wins, so a root does not depend on wire order.
      if (ra < rb) this._p[rb] = ra; else this._p[ra] = rb;
    }
  }

  // ── Breadboard node identity ────────────────────────────────
  const TOP_BODY = new Set(['a','b','c','d','e']);
  const BOT_BODY = new Set(['f','g','h','i','j']);

  function bbNodeId(col, row) {
    if (TOP_BODY.has(row)) return `bb_top_${col}`;
    if (BOT_BODY.has(row)) return `bb_bot_${col}`;
    return `bb_rail_${row}`; // tp | tn | bn | bp
  }

  // ── Build graph ─────────────────────────────────────────────
  function buildGraph(components, wires) {
    const uf      = new UnionFind();
    const pinNode = []; // pinNode[ci][pi] = raw node string

    // 1. Assign every component pin to a node
    components.forEach((comp, ci) => {
      pinNode[ci] = [];
      comp.pins.forEach((_, pi) => {
        let nid;
        if (comp.holeRefs?.[pi]) {
          const { col, row } = comp.holeRefs[pi];
          nid = bbNodeId(col, row);
        } else {
          nid = `free_${ci}_${pi}`;
        }
        pinNode[ci][pi] = nid;
        uf.make(nid);
      });
    });

    // 2. Wires merge nodes — wires store startHole/endHole for breadboard
    //    holes and startComp/startPinIdx for off-board pins (e.g. battery).
    wires.forEach(wire => {
      const { startHole, endHole, startComp, startPinIdx, endComp, endPinIdx } = wire;

      // Resolve each endpoint to a node string
      let na = startHole ? bbNodeId(startHole.col, startHole.row) : null;
      let nb = endHole   ? bbNodeId(endHole.col,   endHole.row)   : null;

      // Fall back to component free-pin node when no board hole was recorded
      if (!na && startComp) {
        const ci = components.indexOf(startComp);
        if (ci >= 0 && pinNode[ci]?.[startPinIdx] != null) na = pinNode[ci][startPinIdx];
      }
      if (!nb && endComp) {
        const ci = components.indexOf(endComp);
        if (ci >= 0 && pinNode[ci]?.[endPinIdx] != null) nb = pinNode[ci][endPinIdx];
      }

      if (na && nb) uf.union(na, nb);
    });

    // 3. Buttons that are pressed act as closed switches — merge their two pins
    components.forEach((comp, ci) => {
      if (comp.type === 'button' && comp.pressed) {
        uf.union(pinNode[ci][0], pinNode[ci][1]);
      }
    });

    // 4. Resolve each pin to its root
    return components.map((comp, ci) => ({
      comp,
      // nodes[pi] = root node of pin pi
      nodes: comp.pins.map((_, pi) => uf.find(pinNode[ci][pi])),
    }));
  }

  // ── Netlist construction ─────────────────────────────────────
  //
  //  buildGraph already resolves the board into true electrical
  //  nodes, and that part was always right. What follows replaces
  //  path walking: the node graph becomes a netlist and the solver
  //  enforces Kirchhoff's Current Law at every node at once.
  //
  //  Pin conventions (app.js):
  //    battery   pin 0 = +        pin 1 = -
  //    led       pin 0 = cathode  pin 1 = anode
  //
  function buildNetlist(graph) {
    const elements = [];
    const nodeSet  = new Set();
    const track    = n => { nodeSet.add(n); return n; };

    graph.forEach((entry, ci) => {
      const { comp, nodes } = entry;
      const id = comp.type + '_' + ci;
      comp._simId = id;
      const p = propsOf(comp);

      switch (comp.type) {
        case 'battery':
          elements.push({ id, kind: 'vsource',
            a: track(nodes[0]), b: track(nodes[1]),
            voltage: p.voltage || 0 });
          break;

        case 'resistor':
        case 'buzzer':
          elements.push({ id, kind: 'resistor',
            a: track(nodes[0]), b: track(nodes[1]),
            resistance: p.resistance || 0 });
          break;

        case 'led':
          // a = anode (pin 1), b = cathode (pin 0). Reverse bias now
          // falls out of the device model instead of needing the
          // separate polarity pass the path walker had to do.
          elements.push({ id, kind: 'diode', model: 'pwl',
            a: track(nodes[LED_ANODE_PIN]),
            b: track(nodes[1 - LED_ANODE_PIN]),
            vf: p.forwardVoltage || 0 });
          break;

        case 'button':
          track(nodes[0]); track(nodes[1]);
          // A pressed button is already collapsed to one node by the
          // Union-Find pass. An OPEN button contributes no element:
          // an open circuit is a missing branch, not a big resistor.
          if (comp.pressed && nodes[0] !== nodes[1]) {
            elements.push({ id, kind: 'short', a: nodes[0], b: nodes[1] });
          }
          break;

        default:
          nodes.forEach(track);
      }
    });

    return { nodes: [...nodeSet], elements };
  }

  function analyze(components, wires) {
    const blank = { lines: [], ledsOn: [], buzzersOn: [], branches: [] };

    if (!components.length) {
      return Object.assign({}, blank, {
        status: 'empty',
        lines: [{ text: 'No components placed.', cls: 'sim-warn' }],
      });
    }

    const graph     = buildGraph(components, wires);
    const lines     = [];
    const branches  = [];
    const ledsOn    = [];
    const buzzersOn = [];
    const bats      = graph.filter(g => g.comp.type === 'battery');
    const buttons   = components.filter(c => c.type === 'button');

    buttons.forEach((btn, i) => {
      const state = btn.pressed ? '🟢 CLOSED (current flowing)' : '⭕ OPEN — click to press';
      lines.push({ text: `Button ${i + 1}: ${state}`, cls: btn.pressed ? 'sim-on' : 'sim-info' });
    });

    if (!bats.length) {
      return Object.assign({}, blank, {
        status: 'no-battery',
        lines: [{ text: 'No battery in circuit.', cls: 'sim-warn' }],
      });
    }

    // ── Build the netlist and solve the whole board at once ───
    //
    //  Every battery is in the SAME system. Solving one supply at a
    //  time was what made two cells in series report the current of
    //  one, because the other cell was walked over as plain wire.
    const netlist  = buildNetlist(graph);
    netlist.ground = bats[0].nodes[1];        // first battery − is the reference
    const elemById = new Map(netlist.elements.map(e => [e.id, e]));

    bats.forEach((bat, bi) => {
      const V = propsOf(bat.comp).voltage || 0;
      lines.push({ text: `Battery ${bi + 1}: ${V}V`, cls: 'sim-info' });
    });

    const sol = MNA.solve(netlist);
    const nodeVoltages = sol.ok ? sol.voltages : undefined;
    const vAt = n => (nodeVoltages ? (nodeVoltages[n] ?? 0) : 0);
    const iOf = comp => sol.currents[comp._simId] ?? 0;

    if (!sol.ok) {
      lines.push({ text: '  ⚠ Circuit could not be solved — check for conflicting connections.',
                   cls: 'sim-err' });
      return { status: 'ok', lines, ledsOn, buzzersOn, branches, nodeVoltages };
    }

    const supplyI = bats.reduce((s, b) => s + Math.abs(iOf(b.comp)), 0);
    const outputs = graph.filter(g => g.comp.type === 'led' || g.comp.type === 'buzzer');

    // ── Short circuit ─────────────────────────────────────────
    //  A real short is now detected by the current the solver
    //  actually reports, not by "this path happens to contain no
    //  resistor". A buzzer straight across the battery is a short
    //  too, and the old resistance test never caught it.
    if (supplyI >= SHORT_CIRCUIT_A) {
      const V      = propsOf(bats[0].comp).voltage || 0;
      const victim = outputs.find(g => propsOf(g.comp).maxCurrent) ||
                     outputs[0] || null;

      if (victim) {
        const p      = propsOf(victim.comp);
        const max    = p.maxCurrent || 0.020;
        const totalVf = p.forwardVoltage || 0;
        const minR   = Math.ceil((V - totalVf) / max);
        lines.push({
          text: "  Short circuit. The " + victim.comp.type.toUpperCase() +
                " sits straight across the battery with no current-limiting resistor.",
          cls: "sim-err",
        });
        lines.push({
          text: "  A series resistor sets the current: (" + V + "V - " + totalVf + "V) / " +
                (max * 1000).toFixed(0) + " mA = " + minR + " ohm minimum, so use a " +
                stockResistor(minR) + " ohm.",
          cls: "sim-info",
        });
      } else {
        lines.push({ text: '  ⚠ Short circuit — no resistance in path!', cls: 'sim-err' });
      }
      branches.push({ battery: 0, path: [], totalR: 0, totalVf: 0, current: 0, shorted: true });
      return { status: 'ok', lines, ledsOn, buzzersOn, branches, nodeVoltages };
    }

    // ── Polarity, checked before anything else ────────────────
    //  A backwards LED blocks its branch, so by current alone the
    //  board looks open. "Circuit open" is a useless thing to say
    //  when the real answer is that a part is in the wrong way round.
    const backwards = [];
    outputs.forEach(({ comp }) => {
      if (comp.type !== 'led') return;
      const el = elemById.get(comp._simId);
      if (!el) return;
      const vd = vAt(el.a) - vAt(el.b);
      if (vd < -0.5 && iOf(comp) < propsOf(comp).thresholdCurrent) {
        backwards.push(comp);
        lines.push({ text: '  LED is backwards. Current cannot flow from cathode to anode. Flip it around.',
                     cls: 'sim-warn' });
      }
    });

    // ── Open circuit ──────────────────────────────────────────
    if (supplyI < OPEN_CIRCUIT_A) {
      if (!backwards.length) {
        lines.push({ text: '  Circuit open — no complete path.', cls: 'sim-warn' });
      }
      const posNode = bats[0].nodes[0], negNode = bats[0].nodes[1];
      const hasBatConn = graph.some(g =>
        g.comp !== bats[0].comp && g.nodes.some(n => n === posNode || n === negNode));
      if (!hasBatConn) {
        lines.push({ text: '  ⚠ Battery terminals not connected to anything.', cls: 'sim-warn' });
      }
      return { status: 'ok', lines, ledsOn, buzzersOn, branches, nodeVoltages };
    }

    // ── Report each output device ─────────────────────────────
    //  There are no enumerated paths any more, so a "branch" is one
    //  output device and the current the solver says flows through
    //  it. Two LEDs sharing a resistor are two branches whose
    //  currents sum to the resistor's, which is the whole point.
    outputs.forEach(({ comp }) => {
      const I  = iOf(comp);
      const p  = propsOf(comp);
      const el = elemById.get(comp._simId);
      const vd = el ? vAt(el.a) - vAt(el.b) : 0;

      // Already announced above, and it carries nothing worth reporting.
      if (backwards.includes(comp)) return;
      if (comp.type === 'led' && vd < 0.5 && I < p.thresholdCurrent) return;

      const I_mA = I * 1000;
      branches.push({
        battery: 0, path: [], totalR: 0,
        totalVf: p.forwardVoltage || 0,
        current: I, shorted: false,
      });

      if (I >= p.thresholdCurrent) {
        if (comp.type === 'led') {
          ledsOn.push(comp);
          lines.push({ text: `  💡 LED ON  (${I_mA.toFixed(1)} mA)`, cls: 'sim-on' });
          // netV is the voltage the series resistance has to drop.
          const netV = (propsOf(bats[0].comp).voltage || 0) - (p.forwardVoltage || 0);
          const over = overCurrentLine(comp, I, netV);
          if (over) lines.push(over);
        } else {
          buzzersOn.push(comp);
          lines.push({ text: `  🔔 BUZZER ON  (${I_mA.toFixed(1)} mA)`, cls: 'sim-on' });
        }
      } else {
        lines.push({
          text: comp.type === 'led' ? '  LED: current too low.' : '  Buzzer: current too low.',
          cls: 'sim-warn' });
      }
    });

    // ── Resistor-only circuits still deserve numbers ──────────
    //  A voltage divider is the most common teaching circuit there
    //  is, and the old engine printed nothing at all for it.
    if (!outputs.length) {
      const rs = graph.filter(g => g.comp.type === 'resistor');
      rs.forEach(({ comp }) => {
        const I = Math.abs(iOf(comp));
        const R = propsOf(comp).resistance || 0;
        lines.push({
          text: `  Resistor ${R} ohm — ${(I * 1000).toFixed(2)} mA, ${(I * I * R * 1000).toFixed(0)} mW`,
          cls: 'sim-info' });
      });
      if (rs.length) {
        branches.push({ battery: 0, path: [], totalR: 0, totalVf: 0,
                        current: Math.abs(iOf(rs[0].comp)), shorted: false });
      }
      lines.push({ text: '  No output components in circuit path.', cls: 'sim-info' });
    } else if (!ledsOn.length && !buzzersOn.length && !backwards.length) {
      lines.push({ text: '  No output components in circuit path.', cls: 'sim-info' });
    }

    // ── Node voltages, the thing the old engine never had ─────
    if (nodeVoltages) {
      const interesting = Object.keys(nodeVoltages)
        .filter(n => n.startsWith('bb_') && Math.abs(nodeVoltages[n]) > 1e-6)
        .sort((a, b) => nodeVoltages[b] - nodeVoltages[a]);
      if (interesting.length) {
        lines.push({
          text: '  Node voltages: ' +
                interesting.map(n => `${n.replace('bb_', '')} = ${nodeVoltages[n].toFixed(2)}V`).join(', '),
          cls: 'sim-info' });
      }
    }

    return { status: 'ok', lines, ledsOn, buzzersOn, branches, nodeVoltages };
  }

  // ── Presentation ─────────────────────────────────────────────
  //  DOM, THREE and audio live below this line.

  // ── Buzzer audio ─────────────────────────────────────────────
  let _audioCtx = null;
  const _buzzerNodes = new Map(); // comp → { osc, gain }

  function _getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
  }

  function activateBuzzer(comp) {
    if (_buzzerNodes.has(comp)) return;
    try {
      const ctx  = _getAudioCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 220;   // low, buzzy tone
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _buzzerNodes.set(comp, { osc, gain });
    } catch {}
  }

  function deactivateBuzzer(comp) {
    const node = _buzzerNodes.get(comp);
    if (!node) return;
    try {
      const ctx = _getAudioCtx();
      node.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      setTimeout(() => { try { node.osc.stop(); } catch {} }, 80);
    } catch {}
    _buzzerNodes.delete(comp);
  }

  function stopAllBuzzers() {
    _buzzerNodes.forEach((node) => {
      try {
        const ctx = _getAudioCtx();
        node.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        setTimeout(() => { try { node.osc.stop(); } catch {} }, 80);
      } catch {}
    });
    _buzzerNodes.clear();
  }

  // ── Visual: LED on/off ──────────────────────────────────────
  const activeLights = [];

  function lightUpLED(comp) {
    comp.group.traverse(obj => {
      if (!obj.isMesh || !obj.material.transparent) return;
      obj.material = obj.material.clone();
      obj.material.emissiveIntensity = 3.5;
      obj.material.opacity = 1.0;
    });

    const ledColor = getDomeColor(comp) ?? 0xffffff;
    const p0 = comp.pins[0], p1 = comp.pins[1];
    const light = new THREE.PointLight(ledColor, 8.0, 10);
    light.position.set((p0.x + p1.x) / 2, 3.0, (p0.z + p1.z) / 2);
    App.scene.add(light);
    activeLights.push(light);
    comp._simLight = light;
  }

  function dimLED(comp) {
    comp.group.traverse(obj => {
      if (!obj.isMesh || !obj.material.transparent) return;
      obj.material.emissiveIntensity = 0.45;
      obj.material.opacity = 0.88;
    });
    if (comp._simLight) { App.scene.remove(comp._simLight); comp._simLight = null; }
  }

  function getDomeColor(comp) {
    let col = null;
    comp.group.traverse(obj => {
      if (obj.isMesh && obj.material.transparent && col === null)
        col = obj.material.color.getHex();
    });
    return col;
  }

  // ── Results overlay ─────────────────────────────────────────
  function showResults(lines) {
    let box = document.getElementById('sim-results');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sim-results';
      document.getElementById('canvas-wrap').appendChild(box);
    }
    box.innerHTML = lines.map(l =>
      `<div class="sim-line ${l.cls || ''}">${l.text}</div>`
    ).join('');
    box.style.display = 'block';
  }

  function hideResults() {
    const b = document.getElementById('sim-results');
    if (b) b.style.display = 'none';
  }

  // ── Button click handler (active only during simulation) ─────
  let _btnClickHandler = null;

  function installButtonClicks() {
    removeButtonClicks();
    const canvas    = document.getElementById('canvas');
    const raycaster = new THREE.Raycaster();
    const mouseNDC  = new THREE.Vector2();

    _btnClickHandler = function (e) {
      // Only fire on a clean click (not a drag)
      const r = canvas.getBoundingClientRect();
      mouseNDC.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
      mouseNDC.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, App.camera);

      const capMeshes = [];
      App.state.components.forEach(c => {
        if (c.type === 'button' && c.capMesh) capMeshes.push(c.capMesh);
      });
      if (!capMeshes.length) return;

      const hits = raycaster.intersectObjects(capMeshes, false);
      if (!hits.length) return;

      const cap  = hits[0].object;
      const comp = cap.userData.ownerComp;
      if (comp) {
        App.toggleButton(comp);   // animate cap + flip comp.pressed
        App.runSimulation();      // re-evaluate circuit with new button state
      }
    };

    canvas.addEventListener('click', _btnClickHandler);
  }

  function removeButtonClicks() {
    if (_btnClickHandler) {
      const canvas = document.getElementById('canvas');
      canvas.removeEventListener('click', _btnClickHandler);
      _btnClickHandler = null;
    }
  }

  // ── Internal: clear visual state only (no button/UI reset) ──
  function clearSimVisuals() {
    activeLights.forEach(l => App.scene.remove(l));
    activeLights.length = 0;
    App.state.components.forEach(c => {
      if (c.type === 'led')    dimLED(c);
      if (c.type === 'buzzer') deactivateBuzzer(c);
    });
    stopAllBuzzers();
    hideResults();
  }

  // ── Public: runSimulation ────────────────────────────────────
  //  Solve with analyze(), then render the result.
  function runSimulation() {
    const { components, wires } = App.state;
    const isRerun = _btnClickHandler !== null; // already running = button click re-run
    clearSimVisuals(); // preserve button states across re-runs

    // Switch to select mode so user can click components during simulation
    if (!isRerun && App.setMode) App.setMode('select');

    const result = analyze(components, wires);
    showResults(result.lines);
    if (result.status === 'empty') return;

    result.ledsOn.forEach(lightUpLED);
    result.buzzersOn.forEach(activateBuzzer);

    if (result.status === 'ok') {
      App.simRunning = true;
      document.getElementById('sim-run-btn').style.display  = 'none';
      document.getElementById('sim-stop-btn').style.display = 'inline-flex';
    }
    // Only install the click handler on the first run — re-runs from
    // the button handler itself keep the same handler alive.
    if (!isRerun) installButtonClicks();
  }

  // ── Public: stopSimulation ──────────────────────────────────
  function stopSimulation() {
    clearSimVisuals();
    // Reset all buttons directly — no toggleButton call to avoid re-entrancy
    App.state.components.forEach(c => {
      if (c.type !== 'button') return;
      c.pressed = false;
      const cap = c.capMesh;
      if (!cap) return;
      if (cap.userData._animId) { cancelAnimationFrame(cap.userData._animId); cap.userData._animId = null; }
      cap.position.y = cap.userData.capRestY;
      if (cap.userData.matCloned) {
        cap.material.color.setHex(0xe8e8e8);
        cap.material.emissive.setHex(0x000000);
        cap.material.emissiveIntensity = 0;
      }
    });
    App.simRunning = false;
    removeButtonClicks();
    const runBtn  = document.getElementById('sim-run-btn');
    const stopBtn = document.getElementById('sim-stop-btn');
    if (runBtn)  runBtn.style.display  = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
  }

  // ── Wiring ───────────────────────────────────────────────────
  function install(app) {
    App = app;
    App.PROPS          = PROPS;
    App.runSimulation  = runSimulation;
    App.stopSimulation = stopSimulation;
  }

  return { PROPS, UnionFind, bbNodeId, buildGraph, buildNetlist, analyze, install };
});
