// ─────────────────────────────────────────────────────────────
//  simulate.js — Circuit simulation engine
//
//  How it works:
//  1. Every component pin maps to a "node" (electrical connection point).
//  2. Breadboard holes in the same column + same half (a-e or f-j) share
//     a node — they are internally connected, just like a real breadboard.
//     Power-rail holes share a node along their entire row.
//  3. Wires merge the nodes they connect (union-find).
//  4. For each battery we DFS through the node/component graph looking for
//     a complete path from the + terminal back to the − terminal.
//  5. If a path exists: I = (V_batt − ΣVf) / ΣR
//     Any LED in that path with I > threshold lights up.
//
//  Exports: App.runSimulation(), App.stopSimulation()
// ─────────────────────────────────────────────────────────────

(function (App) {

  // ── Component electrical properties ────────────────────────
  const PROPS = {
    battery:  { voltage: 9.0 },
    resistor: { resistance: 220 },      // 220 Ω default
    led:      { forwardVoltage: 2.0, thresholdCurrent: 0.001 },
  };

  // ── Union-Find (path compression) ──────────────────────────
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
  // Holes in the same column and same body-half are wired together.
  // Power rail holes share one node per rail.
  const TOP_BODY = new Set(['a','b','c','d','e']);
  const BOT_BODY = new Set(['f','g','h','i','j']);

  function bbNodeId(col, row) {
    if (TOP_BODY.has(row)) return `bb_top_${col}`;
    if (BOT_BODY.has(row)) return `bb_bot_${col}`;
    // power rails span the whole board — one node each
    return `bb_rail_${row}`;
  }

  // ── Build the electrical node graph ────────────────────────
  function buildGraph(components, wires) {
    const uf = new UnionFind();

    // 1. Assign initial node to every pin
    const pinNode = []; // pinNode[ci][pi] = raw node string

    components.forEach((comp, ci) => {
      pinNode[ci] = [];
      comp.pins.forEach((_, pi) => {
        let nid;
        if (comp.holeRefs?.[pi]) {
          const { col, row } = comp.holeRefs[pi];
          nid = bbNodeId(col, row);
        } else {
          // Battery or floating component — own unique node per pin
          nid = `free_${ci}_${pi}`;
        }
        pinNode[ci][pi] = nid;
        uf.make(nid);
      });
    });

    // 2. Merge nodes that wires connect
    wires.forEach(wire => {
      const { startComp, startPinIdx, endComp, endPinIdx } = wire;
      if (!startComp || !endComp) return;

      const si = components.indexOf(startComp);
      const ei = components.indexOf(endComp);
      if (si < 0 || ei < 0) return;

      const na = pinNode[si]?.[startPinIdx];
      const nb = pinNode[ei]?.[endPinIdx];
      if (na !== undefined && nb !== undefined) uf.union(na, nb);
    });

    // 3. Resolve each pin to its root node
    const graph = components.map((comp, ci) => ({
      comp,
      nodes: comp.pins.map((_, pi) => uf.find(pinNode[ci][pi])),
    }));

    return graph;
  }

  // ── Path finding (DFS with backtracking) ───────────────────
  // Finds a sequence of components forming a closed path from
  // startNode → endNode, excluding the source battery.
  function findPath(graph, startNode, endNode, skipComp) {
    const visited = new Set([startNode]);
    const path    = [];

    function dfs(cur) {
      if (cur === endNode) return true;

      for (const entry of graph) {
        if (entry.comp === skipComp) continue;
        const ns = entry.nodes; // node list for this component

        // A component "bridges" two nodes (simple 2-pin or multi-pin)
        for (let a = 0; a < ns.length; a++) {
          for (let b = 0; b < ns.length; b++) {
            if (a === b) continue;
            if (ns[a] === cur && !visited.has(ns[b])) {
              visited.add(ns[b]);
              path.push(entry);
              if (dfs(ns[b])) return true;
              path.pop();
              visited.delete(ns[b]);
            }
          }
        }
      }
      return false;
    }

    return dfs(startNode) ? [...path] : null;
  }

  // ── Visual: LED on ─────────────────────────────────────────
  const activeLights = []; // point lights added during simulation

  function lightUpLED(comp, current) {
    // Crank up the dome's emissive intensity
    comp.group.traverse(obj => {
      if (!obj.isMesh) return;
      if (obj.material.transparent) {              // the dome
        obj.material = obj.material.clone();
        obj.material.emissiveIntensity = 2.0;
        obj.material.opacity = 0.95;
      }
    });

    // Place a coloured point light above the LED
    const ledColor = getDomeColor(comp) || 0xffffff;
    const light = new THREE.PointLight(ledColor, 3.5, 6);

    // Position the light at the midpoint between the two pins, above the board
    const p0  = comp.pins[0];
    const p1  = comp.pins[1];
    light.position.set((p0.x + p1.x) / 2, 2.5, (p0.z + p1.z) / 2);
    App.scene.add(light);
    activeLights.push(light);
    comp._simLight = light;
  }

  function getDomeColor(comp) {
    let col = null;
    comp.group.traverse(obj => {
      if (obj.isMesh && obj.material.transparent && !col) {
        col = obj.material.color.getHex();
      }
    });
    return col;
  }

  function dimLED(comp) {
    comp.group.traverse(obj => {
      if (obj.isMesh && obj.material.transparent) {
        obj.material.emissiveIntensity = 0.45;
        obj.material.opacity = 0.88;
      }
    });
    if (comp._simLight) {
      App.scene.remove(comp._simLight);
      comp._simLight = null;
    }
  }

  // ── Result overlay helpers ──────────────────────────────────
  function showResults(lines) {
    let box = document.getElementById('sim-results');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sim-results';
      document.getElementById('canvas-wrap').appendChild(box);
    }
    box.innerHTML = lines.map(l => `<div class="sim-line ${l.cls||''}">${l.text}</div>`).join('');
    box.style.display = 'block';
  }

  function hideResults() {
    const box = document.getElementById('sim-results');
    if (box) box.style.display = 'none';
  }

  // ── Public: runSimulation ───────────────────────────────────
  App.runSimulation = function () {
    const { components, wires } = App.state;

    // Reset any previous sim state
    App.stopSimulation();

    if (!components.length) {
      showResults([{ text: 'No components placed.', cls: 'sim-warn' }]);
      return;
    }

    const graph = buildGraph(components, wires);
    const lines = [];
    let anyOn   = false;

    // Find every battery and try to close its circuit
    const batteries = graph.filter(g => g.comp.type === 'battery');

    if (!batteries.length) {
      showResults([{ text: 'No battery found.', cls: 'sim-warn' }]);
      return;
    }

    batteries.forEach((bat, bi) => {
      const posNode = bat.nodes[0]; // pin 0 = positive (+)
      const negNode = bat.nodes[1]; // pin 1 = negative (−)

      lines.push({ text: `Battery ${bi + 1}: ${PROPS.battery.voltage}V`, cls: 'sim-info' });

      const path = findPath(graph, posNode, negNode, bat.comp);

      if (!path) {
        lines.push({ text: '  Circuit open — no complete path found.', cls: 'sim-warn' });
        return;
      }

      // Sum resistance and forward-voltage drops along the path
      let totalR  = 0;
      let totalVf = 0;

      path.forEach(entry => {
        const p = PROPS[entry.comp.type] || {};
        totalR  += p.resistance      || 0;
        totalVf += p.forwardVoltage  || 0;
        lines.push({ text: `  → ${entry.comp.type}`, cls: 'sim-path' });
      });

      const netV = PROPS.battery.voltage - totalVf;

      if (netV <= 0) {
        lines.push({ text: '  Voltage too low to drive circuit.', cls: 'sim-warn' });
        return;
      }
      if (totalR === 0) {
        lines.push({ text: '  ⚠ Short circuit! No resistance in path.', cls: 'sim-err' });
        return;
      }

      const I_mA = (netV / totalR) * 1000;
      lines.push({ text: `  Current: ${I_mA.toFixed(1)} mA`, cls: 'sim-info' });

      // Activate components
      path.forEach(entry => {
        if (entry.comp.type === 'led') {
          if ((netV / totalR) >= PROPS.led.thresholdCurrent) {
            lightUpLED(entry.comp, netV / totalR);
            lines.push({ text: `  💡 LED is ON  (${I_mA.toFixed(1)} mA)`, cls: 'sim-on' });
            anyOn = true;
          } else {
            lines.push({ text: '  LED: insufficient current.', cls: 'sim-warn' });
          }
        }
      });
    });

    if (!lines.length) lines.push({ text: 'Nothing to simulate.', cls: 'sim-warn' });
    showResults(lines);

    // Swap toolbar button
    document.getElementById('sim-run-btn').style.display  = 'none';
    document.getElementById('sim-stop-btn').style.display = 'inline-flex';
  };

  // ── Public: stopSimulation ──────────────────────────────────
  App.stopSimulation = function () {
    // Remove point lights
    activeLights.forEach(l => App.scene.remove(l));
    activeLights.length = 0;

    // Restore all LEDs to original emissive
    App.state.components.forEach(comp => {
      if (comp.type === 'led') dimLED(comp);
    });

    hideResults();
    document.getElementById('sim-run-btn').style.display  = 'inline-flex';
    document.getElementById('sim-stop-btn').style.display = 'none';
  };

})(window.App = window.App || {});
