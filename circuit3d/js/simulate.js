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
//    bb_rail_tp    →  all holes in the top + rail row
//    bb_rail_tn    →  all holes in the top − rail row
//    bb_rail_bn    →  all holes in the bottom − rail row
//    bb_rail_bp    →  all holes in the bottom + rail row
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
  };

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

    // 2. Wires merge nodes — wires now store startHole / endHole
    wires.forEach(wire => {
      const { startHole, endHole } = wire;
      // A wire can have holeRefs (placed on board) or be null if free
      const na = startHole ? bbNodeId(startHole.col, startHole.row) : null;
      const nb = endHole   ? bbNodeId(endHole.col,   endHole.row)   : null;
      if (na && nb) uf.union(na, nb);
    });

    // 3. Resolve each pin to its root
    return components.map((comp, ci) => ({
      comp,
      // nodes[pi] = root node of pin pi
      nodes: comp.pins.map((_, pi) => uf.find(pinNode[ci][pi])),
    }));
  }

  // ── Path finding ─────────────────────────────────────────────
  //
  //  DFS from startNode → endNode, respecting polarity:
  //   - A resistor can be traversed in either direction.
  //   - An LED can only be traversed from anode (pin 1) → cathode (pin 0).
  //   - A battery is the source; it is excluded from the search.
  //
  //  Returns ordered list of { comp, enteredViaPinIdx, exitedViaPinIdx }
  //  or null if no path exists.
  //
  function findPath(graph, startNode, endNode, skipComp) {
    const visited = new Set([startNode]);
    const path    = [];

    function dfs(cur) {
      if (cur === endNode) return true;

      for (const entry of graph) {
        if (entry.comp === skipComp) continue;
        const ns = entry.nodes;

        for (let inPin = 0; inPin < ns.length; inPin++) {
          if (ns[inPin] !== cur) continue;

          for (let outPin = 0; outPin < ns.length; outPin++) {
            if (outPin === inPin) continue;

            // ── Polarity check for LED ───────────────────
            // Current enters at anode (pin 1) and exits at cathode (pin 0).
            // So valid traversal: inPin=1, outPin=0.
            if (entry.comp.type === 'led') {
              if (inPin !== 1 || outPin !== 0) continue;
            }
            // ─────────────────────────────────────────────

            const next = ns[outPin];
            if (visited.has(next)) continue;

            visited.add(next);
            path.push({ comp: entry.comp, inPin, outPin });
            if (dfs(next)) return true;
            path.pop();
            visited.delete(next);
          }
        }
      }
      return false;
    }

    return dfs(startNode) ? [...path] : null;
  }

  // ── Visual: LED on/off ──────────────────────────────────────
  const activeLights = [];

  function lightUpLED(comp) {
    comp.group.traverse(obj => {
      if (!obj.isMesh || !obj.material.transparent) return;
      obj.material = obj.material.clone();
      obj.material.emissiveIntensity = 2.2;
      obj.material.opacity = 0.97;
    });

    const ledColor = getDomeColor(comp) ?? 0xffffff;
    const p0 = comp.pins[0], p1 = comp.pins[1];
    const light = new THREE.PointLight(ledColor, 4.0, 7);
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

  // ── Public: runSimulation ───────────────────────────────────
  App.runSimulation = function () {
    const { components, wires } = App.state;
    App.stopSimulation();

    if (!components.length) {
      showResults([{ text: 'No components placed.', cls: 'sim-warn' }]);
      return;
    }

    const graph   = buildGraph(components, wires);
    const lines   = [];
    const bats    = graph.filter(g => g.comp.type === 'battery');

    if (!bats.length) {
      showResults([{ text: 'No battery in circuit.', cls: 'sim-warn' }]);
      return;
    }

    bats.forEach((bat, bi) => {
      const posNode = bat.nodes[0];  // + terminal node
      const negNode = bat.nodes[1];  // − terminal node
      const V       = PROPS.battery.voltage;

      lines.push({ text: `Battery ${bi + 1}: ${V}V`, cls: 'sim-info' });

      const path = findPath(graph, posNode, negNode, bat.comp);

      if (!path) {
        lines.push({ text: '  Circuit open — no complete path.', cls: 'sim-warn' });

        // Give more specific hints
        const hasBatConn = graph.some(g =>
          g.comp !== bat.comp && g.nodes.some(n => n === posNode || n === negNode));
        if (!hasBatConn) {
          lines.push({ text: '  ⚠ Battery terminals not connected to anything.', cls: 'sim-warn' });
        }
        return;
      }

      let totalR  = 0;
      let totalVf = 0;
      path.forEach(step => {
        const p = PROPS[step.comp.type] || {};
        totalR  += p.resistance     || 0;
        totalVf += p.forwardVoltage || 0;
        lines.push({ text: `  → ${step.comp.type}`, cls: 'sim-path' });
      });

      const netV = V - totalVf;
      if (netV <= 0) {
        lines.push({ text: '  Voltage too low to drive circuit.', cls: 'sim-warn' });
        return;
      }
      if (totalR === 0) {
        lines.push({ text: '  ⚠ Short circuit — no resistance in path!', cls: 'sim-err' });
        return;
      }

      const I    = netV / totalR;
      const I_mA = I * 1000;
      lines.push({ text: `  Current: ${I_mA.toFixed(1)} mA`, cls: 'sim-info' });

      path.forEach(step => {
        if (step.comp.type === 'led') {
          if (I >= PROPS.led.thresholdCurrent) {
            lightUpLED(step.comp);
            lines.push({ text: `  💡 LED ON  (${I_mA.toFixed(1)} mA)`, cls: 'sim-on' });
          } else {
            lines.push({ text: '  LED: current too low.', cls: 'sim-warn' });
          }
        }
      });
    });

    showResults(lines);
    document.getElementById('sim-run-btn').style.display  = 'none';
    document.getElementById('sim-stop-btn').style.display = 'inline-flex';
  };

  // ── Public: stopSimulation ──────────────────────────────────
  App.stopSimulation = function () {
    activeLights.forEach(l => App.scene.remove(l));
    activeLights.length = 0;
    App.state.components.forEach(c => { if (c.type === 'led') dimLED(c); });
    hideResults();
    const runBtn  = document.getElementById('sim-run-btn');
    const stopBtn = document.getElementById('sim-stop-btn');
    if (runBtn)  runBtn.style.display  = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
  };

})(window.App = window.App || {});
