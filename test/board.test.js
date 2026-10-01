// Board-level tests: the cases simulate.test.js does not reach.
//
// These drive analyze() through real breadboard placements rather than
// the solver directly, so they cover the netlist construction step:
// button gating, the power rails, and a short caught by measured
// current rather than by "this path contains no resistor".
//
// Run with:  node --test

const test   = require('node:test');
const assert = require('node:assert');

const Sim = require('../circuit3d/js/simulate.js');

function pins(n) { return Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 })); }
function comp(type, holes, extra) {
  return Object.assign({ type, pins: pins(holes.length), holeRefs: holes }, extra || {});
}
const h    = (col, row) => ({ col, row });
const wire = (a, b) => ({ startHole: a, endHole: b });
const mA   = i => i * 1000;
const texts = r => r.lines.map(l => l.text);
const hasLine = (r, sub) => texts(r).some(t => t.includes(sub));

// ── Buttons gate the circuit ─────────────────────────────────

function buttonCircuit(pressed) {
  const bat = comp('battery',  [h(1, 'tp'), h(1, 'tn')]);
  const res = comp('resistor', [h(5, 'a'),  h(10, 'a')]);
  const btn = comp('button',   [h(10, 'a'), h(14, 'a')], { pressed });
  const led = comp('led',      [h(20, 'a'), h(14, 'a')]); // cathode col20, anode col14
  const wires = [wire(h(2, 'tp'), h(5, 'a')), wire(h(20, 'a'), h(2, 'tn'))];
  return { components: [bat, res, btn, led], wires };
}

test('an open button leaves the circuit open', () => {
  const { components, wires } = buttonCircuit(false);
  const r = Sim.analyze(components, wires);
  assert.equal(r.ledsOn.length, 0);
  assert.ok(hasLine(r, 'Circuit open'), texts(r).join(' | '));
});

test('a pressed button closes it and the LED lights at (9-2)/470', () => {
  const { components, wires } = buttonCircuit(true);
  const r = Sim.analyze(components, wires);
  assert.equal(r.ledsOn.length, 1);
  assert.ok(Math.abs(mA(r.branches[0].current) - 14.894) < 0.01,
    `expected 14.894 mA, got ${mA(r.branches[0].current)}`);
});

// ── Power rails ──────────────────────────────────────────────

test('a rail carries the supply the length of the board', () => {
  const bat = comp('battery',  [h(1, 'tp'), h(1, 'tn')]);
  const res = comp('resistor', [h(58, 'a'), h(50, 'a')]);
  const led = comp('led',      [h(45, 'a'), h(50, 'a')]);
  const wires = [wire(h(57, 'tp'), h(58, 'a')), wire(h(45, 'a'), h(46, 'tn'))];
  const r = Sim.analyze([bat, res, led], wires);
  assert.equal(r.ledsOn.length, 1, texts(r).join(' | '));
});

// ── A buzzer straight across the battery is a short too ──────
//  The old engine only called something a short when the path had
//  literally zero resistance, so a 42 ohm buzzer across 9V read as
//  a healthy 214 mA. The check is now the current the solver
//  reports, so the device's own resistance cannot hide it.

test('a buzzer straight across the battery is flagged, not reported healthy', () => {
  const bat = comp('battery', [h(1, 'tp'), h(1, 'tn')]);
  const buz = comp('buzzer',  [h(1, 'tp'), h(1, 'tn')], { values: { resistance: 4, thresholdCurrent: 0.001, maxCurrent: 0.05 } });
  const r = Sim.analyze([bat, buz], []);
  assert.ok(r.branches.length && r.branches[0].shorted, texts(r).join(' | '));
  assert.ok(hasLine(r, 'Short circuit'), texts(r).join(' | '));
  assert.equal(r.buzzersOn.length, 0);
});

// ── Node voltages are reported for a plain resistor circuit ──

test('a resistor-only circuit still reports numbers', () => {
  const bat = comp('battery',  [h(1, 'tp'), h(1, 'tn')]);
  const r1  = comp('resistor', [h(5, 'a'),  h(10, 'a')]);
  const r2  = comp('resistor', [h(10, 'a'), h(15, 'a')]);
  const wires = [wire(h(2, 'tp'), h(5, 'a')), wire(h(15, 'a'), h(2, 'tn'))];
  const r = Sim.analyze([bat, r1, r2], wires);

  assert.ok(r.nodeVoltages, 'node voltages present');
  assert.ok(hasLine(r, 'Node voltages'), texts(r).join(' | '));
  assert.ok(texts(r).some(t => /Resistor \d+ ohm/.test(t)),
    'per-resistor numbers are printed: ' + texts(r).join(' | '));
});

// ── Three LEDs on one resistor still obey KCL ────────────────

test('three LEDs sharing one resistor split its current three ways', () => {
  const bat = comp('battery',  [h(1, 'tp'), h(1, 'tn')]);
  const res = comp('resistor', [h(5, 'a'),  h(10, 'a')]);
  const l1  = comp('led', [h(1, 'tn'),  h(10, 'a')]);
  const l2  = comp('led', [h(3, 'tn'),  h(10, 'a')]);
  const l3  = comp('led', [h(5, 'tn'),  h(10, 'a')]);
  const wires = [wire(h(2, 'tp'), h(5, 'a'))];
  const r = Sim.analyze([bat, res, l1, l2, l3], wires);

  assert.equal(r.branches.length, 3);
  const total = r.branches.reduce((s, b) => s + b.current, 0);
  assert.ok(Math.abs(mA(total) - 14.894) < 0.01,
    `three branches must still sum to 14.894 mA, got ${mA(total)}`);
  r.branches.forEach(b => {
    assert.ok(Math.abs(mA(b.current) - 14.894 / 3) < 0.01,
      `expected ${(14.894 / 3).toFixed(3)} mA each, got ${mA(b.current)}`);
  });
});
