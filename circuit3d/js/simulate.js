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
//  If the circuit drives current the wrong way the LED stays off.
//  Battery: pin 0 = positive (+) output, pin 1 = negative (−) return.
//
//  Exports: App.runSimulation(), App.stopSimulation()
// ─────────────────────────────────────────────────────────────

(function (App) {

  // ── Electrical properties ───────────────────────────────────
  const PROPS = {
    battery:  { voltage: 9.0 },
    resistor: { resistance: 220 },    // 220 Ω default
    led:      { forwardVoltage: 2.0, thresholdCurrent: 0.001 },
    buzzer:   { resistance: 42,      thresholdCurrent: 0.001 },
  };

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
      if (ra !== rb) this._p[rb] = ra;
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

  // ── Path finding ─────────────────────────────────────────────
  //
  //  Backtracking DFS — finds ALL complete paths from startNode to
  //  endNode so that parallel branches (multiple LEDs) are each
  //  evaluated independently.  Cap at 30 paths for safety.
  //
  function findAllPaths(graph, startNode, endNode, skipComp) {
    const allPaths = [];
    const visited  = new Set([startNode]);
    const path     = [];

    function dfs(cur) {
      if (allPaths.length >= 30) return; // safety cap

      if (cur === endNode) {
        allPaths.push([...path]);
        return; // record path and keep searching (don't stop here)
      }

      for (const entry of graph) {
        if (entry.comp === skipComp) continue;
        // Open buttons break the circuit
        if (entry.comp.type === 'button' && !entry.comp.pressed) continue;
        const ns = entry.nodes;

        for (let inPin = 0; inPin < ns.length; inPin++) {
          if (ns[inPin] !== cur) continue;

          for (let outPin = 0; outPin < ns.length; outPin++) {
            if (outPin === inPin) continue;
            const next = ns[outPin];
            if (visited.has(next)) continue;

            visited.add(next);
            path.push({ comp: entry.comp, inPin, outPin });
            dfs(next);        // don't early-exit; backtrack and keep going
            path.pop();
            visited.delete(next);
          }
        }
      }
    }

    dfs(startNode);
    return allPaths;
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

  // ── Public: runSimulation ───────────────────────────────────
  App.runSimulation = function () {
    const { components, wires } = App.state;
    const isRerun = _btnClickHandler !== null; // already running = button click re-run
    clearSimVisuals(); // preserve button states across re-runs

    // Switch to select mode so user can click components during simulation
    if (!isRerun && App.setMode) App.setMode('select');

    if (!components.length) {
      showResults([{ text: 'No components placed.', cls: 'sim-warn' }]);
      return;
    }

    const graph   = buildGraph(components, wires);
    const lines   = [];
    const bats    = graph.filter(g => g.comp.type === 'battery');
    const buttons = components.filter(c => c.type === 'button');
    buttons.forEach((btn, i) => {
      const state = btn.pressed ? '🟢 CLOSED (current flowing)' : '⭕ OPEN — click to press';
      lines.push({ text: `Button ${i + 1}: ${state}`, cls: btn.pressed ? 'sim-on' : 'sim-info' });
    });

    if (!bats.length) {
      showResults([{ text: 'No battery in circuit.', cls: 'sim-warn' }]);
      if (!isRerun) installButtonClicks();
      return;
    }

    bats.forEach((bat, bi) => {
      const posNode = bat.nodes[0];  // + terminal node
      const negNode = bat.nodes[1];  // − terminal node
      const V       = PROPS.battery.voltage;

      lines.push({ text: `Battery ${bi + 1}: ${V}V`, cls: 'sim-info' });

      const paths = findAllPaths(graph, posNode, negNode, bat.comp);

      if (!paths.length) {
        lines.push({ text: '  Circuit open — no complete path.', cls: 'sim-warn' });
        const hasBatConn = graph.some(g =>
          g.comp !== bat.comp && g.nodes.some(n => n === posNode || n === negNode));
        if (!hasBatConn) {
          lines.push({ text: '  ⚠ Battery terminals not connected to anything.', cls: 'sim-warn' });
        }
        return;
      }

      // Each path is an independent parallel branch — evaluate separately.
      const litLEDs     = new Set();
      const litBuzzers  = new Set();
      let   shortCircuit = false;

      paths.forEach((path, pi) => {
        let totalR  = 0;
        let totalVf = 0;
        path.forEach(step => {
          const p = PROPS[step.comp.type] || {};
          totalR  += p.resistance     || 0;
          totalVf += p.forwardVoltage || 0;
        });

        if (totalR === 0) {
          if (!shortCircuit) {
            lines.push({ text: '  ⚠ Short circuit — no resistance in path!', cls: 'sim-err' });
            shortCircuit = true;
          }
          return;
        }

        const netV = V - totalVf;
        if (netV <= 0) return; // not enough voltage for this branch

        const I    = netV / totalR;
        const I_mA = I * 1000;

        path.forEach(step => {
          const type = step.comp.type;

          if (type === 'led') {
            if (litLEDs.has(step.comp)) return;
            litLEDs.add(step.comp);
            if (I >= PROPS.led.thresholdCurrent) {
              lightUpLED(step.comp);
              lines.push({ text: `  💡 LED ON  (${I_mA.toFixed(1)} mA)`, cls: 'sim-on' });
            } else {
              lines.push({ text: '  LED: current too low.', cls: 'sim-warn' });
            }
          }

          if (type === 'buzzer') {
            if (litBuzzers.has(step.comp)) return;
            litBuzzers.add(step.comp);
            if (I >= PROPS.buzzer.thresholdCurrent) {
              activateBuzzer(step.comp);
              lines.push({ text: `  🔔 BUZZER ON  (${I_mA.toFixed(1)} mA)`, cls: 'sim-on' });
            } else {
              lines.push({ text: '  Buzzer: current too low.', cls: 'sim-warn' });
            }
          }
        });
      });

      if (!shortCircuit && litLEDs.size === 0 && litBuzzers.size === 0 && paths.length > 0) {
        lines.push({ text: '  No output components in circuit path.', cls: 'sim-info' });
      }
    });

    showResults(lines);
    App.simRunning = true;
    document.getElementById('sim-run-btn').style.display  = 'none';
    document.getElementById('sim-stop-btn').style.display = 'inline-flex';
    // Only install the click handler on the first run — re-runs from
    // the button handler itself keep the same handler alive.
    if (!isRerun) installButtonClicks();
  };

  // ── Public: stopSimulation ──────────────────────────────────
  App.stopSimulation = function () {
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
  };

})(window.App = window.App || {});
