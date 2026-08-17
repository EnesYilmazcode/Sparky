// Golden tests for the simulate.js solver.
//
// Run with:  node --test
// No dependencies: node's built-in test runner only.
//
// Tests marked WRONG TODAY assert the behaviour the engine currently has,
// so that the solver replacement produces a visible diff. Each one is
// paired with a skipped test holding the analytically correct answer and
// the issue that will unskip it.

const test   = require('node:test');
const assert = require('node:assert');

const Sim = require('../circuit3d/js/simulate.js');

// ── Fixture helpers ───────────────────────────────────────────
// A component only needs type, pins (for arity) and holeRefs for the
// solver. The 3D group and meshes are presentation and never touched.

function pins(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: 0, y: 0, z: 0 });
  return out;
}

function comp(type, holes, extra) {
  return Object.assign({ type, pins: pins(holes.length), holeRefs: holes }, extra || {});
}

function h(col, row) { return { col, row }; }
function wire(a, b)  { return { startHole: a, endHole: b }; }

// Battery pins sit straight on the rails here. On the real board it is
// off-board and wired to them, which resolves to the same two nodes.
function battery() { return comp('battery', [h(1, 'tp'), h(1, 'tn')]); }

const mA = i => i * 1000;

function texts(result) { return result.lines.map(l => l.text); }
function hasLine(result, substr) { return texts(result).some(t => t.includes(substr)); }

// ── Series: 9V - 220R - LED ───────────────────────────────────
// I = (9 - 2) / 220 = 31.818 mA

test('series battery, resistor, LED: one branch at (9-2)/220', () => {
  const bat = battery();
  const res = comp('resistor', [h(5, 'a'), h(10, 'a')]);
  const led = comp('led',      [h(15, 'a'), h(10, 'a')]); // pin0 cathode, pin1 anode
  const wires = [wire(h(2, 'tp'), h(5, 'a')), wire(h(15, 'a'), h(2, 'tn'))];

  const r = Sim.analyze([bat, res, led], wires);

  assert.equal(r.status, 'ok');
  assert.equal(r.branches.length, 1);
  assert.ok(Math.abs(mA(r.branches[0].current) - 31.818) < 0.01,
    `expected 31.818 mA, got ${mA(r.branches[0].current)}`);
  assert.equal(r.ledsOn.length, 1);
  assert.ok(hasLine(r, 'LED ON  (31.8 mA)'), texts(r).join(' | '));
});

// ── Parallel: 9V - 220R - two LEDs sharing it ─────────────────
// Correct: 31.8 mA through the resistor, 15.9 mA per LED.
// WRONG TODAY: each enumerated path is solved on its own, so both LEDs
// report the full 31.8 mA and KCL is violated at the shared node.
// See issue #8.

function parallelSharedResistor() {
  const bat  = battery();
  const res  = comp('resistor', [h(5, 'a'), h(10, 'a')]);
  const led1 = comp('led', [h(1, 'tn'), h(10, 'a')]);
  const led2 = comp('led', [h(3, 'tn'), h(10, 'a')]);
  const wires = [wire(h(2, 'tp'), h(5, 'a'))];
  return { components: [bat, res, led1, led2], wires };
}

test('parallel LEDs behind one resistor: WRONG TODAY, full current in both (#8)', () => {
  const { components, wires } = parallelSharedResistor();
  const r = Sim.analyze(components, wires);

  assert.equal(r.branches.length, 2);
  r.branches.forEach(b => {
    assert.ok(Math.abs(mA(b.current) - 31.818) < 0.01,
      `expected the current 31.818 mA per branch, got ${mA(b.current)}`);
  });
  assert.equal(r.ledsOn.length, 2);
});

test('parallel LEDs behind one resistor: KCL holds, 15.9 mA each (#8)', { skip: 'blocked on the solver replacement, issue #8' }, () => {
  const { components, wires } = parallelSharedResistor();
  const r = Sim.analyze(components, wires);

  const total = r.branches.reduce((s, b) => s + b.current, 0);
  assert.ok(Math.abs(mA(total) - 31.818) < 0.01, 'branch currents must sum to the resistor current');
  r.branches.forEach(b => {
    assert.ok(Math.abs(mA(b.current) - 15.909) < 0.01);
  });
});

// ── Voltage divider: 9V - 220R - node X - 220R - GND ──────────
// Correct: V(X) = 4.5 V. There is no node voltage anywhere in the
// output today, only a loop current. See issue #9.

function divider() {
  const bat = battery();
  const r1  = comp('resistor', [h(5, 'a'),  h(10, 'a')]);
  const r2  = comp('resistor', [h(10, 'a'), h(15, 'a')]);
  const wires = [wire(h(2, 'tp'), h(5, 'a')), wire(h(15, 'a'), h(2, 'tn'))];
  return { components: [bat, r1, r2], wires, midNode: 'bb_top_10' };
}

test('voltage divider: loop current is right, node voltage is absent (#9)', () => {
  const { components, wires } = divider();
  const r = Sim.analyze(components, wires);

  assert.equal(r.branches.length, 1);
  assert.ok(Math.abs(mA(r.branches[0].current) - 20.454) < 0.01,
    `expected 20.454 mA, got ${mA(r.branches[0].current)}`);
  assert.equal(r.nodeVoltages, undefined, 'no node voltage is computed today');
});

test('voltage divider: V(midpoint) = 4.5 V (#9)', { skip: 'blocked on the solver replacement, issue #9' }, () => {
  const { components, wires, midNode } = divider();
  const r = Sim.analyze(components, wires);

  assert.ok(r.nodeVoltages, 'solver should report node voltages');
  assert.ok(Math.abs(r.nodeVoltages[midNode] - 4.5) < 1e-6);
});

// ── Reverse LED ───────────────────────────────────────────────
// Same circuit as the series test with the LED turned around, so
// current enters the cathode. WRONG TODAY: it lights at full
// brightness. See issue #10.

function reversedLED() {
  const bat = battery();
  const res = comp('resistor', [h(5, 'a'), h(10, 'a')]);
  const led = comp('led',      [h(10, 'a'), h(15, 'a')]); // cathode toward the resistor
  const wires = [wire(h(2, 'tp'), h(5, 'a')), wire(h(15, 'a'), h(2, 'tn'))];
  return { components: [bat, res, led], wires };
}

test('reversed LED: WRONG TODAY, lights at full brightness (#10)', () => {
  const { components, wires } = reversedLED();
  const r = Sim.analyze(components, wires);

  assert.equal(r.ledsOn.length, 1, 'polarity is recorded but never read');
  assert.ok(Math.abs(mA(r.branches[0].current) - 31.818) < 0.01);
});

test('reversed LED: stays dark and says so (#10)', { skip: 'fixed by issue #10' }, () => {
  const { components, wires } = reversedLED();
  const r = Sim.analyze(components, wires);

  assert.equal(r.ledsOn.length, 0);
  assert.ok(hasLine(r, 'backwards'), texts(r).join(' | '));
});

// ── Short circuit: LED straight across the battery ────────────

test('LED across the battery with no resistor is reported as a short', () => {
  const bat = battery();
  const led = comp('led', [h(1, 'tn'), h(1, 'tp')]); // cathode on -, anode on +
  const r = Sim.analyze([bat, led], []);

  assert.equal(r.branches.length, 1);
  assert.equal(r.branches[0].shorted, true);
  assert.equal(r.branches[0].current, 0);
  assert.equal(r.ledsOn.length, 0);
  assert.ok(hasLine(r, 'Short circuit'), texts(r).join(' | '));
});

// ── Open circuit ──────────────────────────────────────────────

test('resistor and LED not wired to the battery leave the circuit open', () => {
  const bat = battery();
  const res = comp('resistor', [h(5, 'a'), h(10, 'a')]);
  const led = comp('led',      [h(15, 'a'), h(10, 'a')]);
  const r = Sim.analyze([bat, res, led], []);

  assert.equal(r.status, 'ok');
  assert.equal(r.branches.length, 0);
  assert.equal(r.ledsOn.length, 0);
  assert.ok(hasLine(r, 'Circuit open'), texts(r).join(' | '));
  assert.ok(hasLine(r, 'Battery terminals not connected'), texts(r).join(' | '));
});

// ── Two batteries in series ───────────────────────────────────
// Correct for 18 V: (18 - 2) / 220 = 72.7 mA. WRONG TODAY: each
// battery is solved alone and the other counts as a 0-ohm wire, so
// the answer is the single-battery answer. See issue #11.

function twoInSeries() {
  const batA = comp('battery', [h(1, 'tp'),  h(20, 'a')]);
  const batB = comp('battery', [h(20, 'a'), h(1, 'tn')]);
  const res  = comp('resistor', [h(5, 'a'), h(10, 'a')]);
  const led  = comp('led',      [h(15, 'a'), h(10, 'a')]);
  const wires = [wire(h(2, 'tp'), h(5, 'a')), wire(h(15, 'a'), h(2, 'tn'))];
  return { components: [batA, batB, res, led], wires };
}

test('two 9V batteries in series: WRONG TODAY, same current as one (#11)', () => {
  const { components, wires } = twoInSeries();
  const r = Sim.analyze(components, wires);

  assert.ok(r.branches.length > 0);
  r.branches.forEach(b => {
    assert.ok(Math.abs(mA(b.current) - 31.818) < 0.01,
      `expected the single-battery current 31.818 mA, got ${mA(b.current)}`);
  });
});

test('two 9V batteries in series: 18 V drives 72.7 mA (#11)', { skip: 'blocked on the solver replacement, issue #11' }, () => {
  const { components, wires } = twoInSeries();
  const r = Sim.analyze(components, wires);

  assert.ok(Math.abs(mA(r.branches[0].current) - 72.727) < 0.01);
});

// ── Degenerate inputs ─────────────────────────────────────────

test('empty board and battery-less board report their own status', () => {
  assert.equal(Sim.analyze([], []).status, 'empty');

  const res = comp('resistor', [h(5, 'a'), h(10, 'a')]);
  const noBat = Sim.analyze([res], []);
  assert.equal(noBat.status, 'no-battery');
  assert.ok(hasLine(noBat, 'No battery in circuit.'));
});

// ── Node extraction ───────────────────────────────────────────

test('buildGraph merges columns, rails and wired holes into one node each', () => {
  const res = comp('resistor', [h(5, 'a'), h(5, 'e')]);   // same column, same half
  const led = comp('led',      [h(5, 'f'), h(9, 'a')]);   // other half of column 5
  const bat = comp('battery',  [h(30, 'tp'), h(1, 'tn')]);
  const graph = Sim.buildGraph([res, led, bat], [wire(h(9, 'a'), h(2, 'tp'))]);

  assert.equal(graph[0].nodes[0], graph[0].nodes[1], 'a-e of a column are one node');
  assert.notEqual(graph[0].nodes[0], graph[1].nodes[0], 'the two halves are separate nodes');
  assert.equal(graph[1].nodes[1], graph[2].nodes[0], 'the wire merged col 9 into the + rail');
  assert.equal(Sim.bbNodeId(5, 'c'), 'bb_top_5');
  assert.equal(Sim.bbNodeId(5, 'h'), 'bb_bot_5');
  assert.equal(Sim.bbNodeId(5, 'tp'), 'bb_rail_tp');
});
