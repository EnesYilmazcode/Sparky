// ─────────────────────────────────────────────────────────────
//  mna.test.js — correctness suite for the MNA solver
//
//  Every linear case is checked against a hand-computed analytic
//  answer, not against a previous run of this code. The nonlinear
//  (LED) cases are checked by verifying Kirchhoff's Current Law
//  closes at every node, which is the property the old path-based
//  engine violated.
//
//  Run: node circuit3d/tests/mna.test.js
// ─────────────────────────────────────────────────────────────

const MNA = require('../circuit3d/js/mna.js');
// Every node carries a deliberate GMIN = 1e-12 S shunt to ground so a
// floating board cannot make the matrix singular. SPICE does the same.
// At 9V that leaks 9e-12 A, so no current assertion can be tighter than
// that. Tolerances below are derived from it rather than hand-picked.
const GMIN_LEAK = 1e-12 * 9;        // 9 pA
const ITOL = GMIN_LEAK * 10;        // 90 pA
const VTOL = 1e-8;


let passed = 0, failed = 0;
const failures = [];

function approx(actual, expected, tol, label) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { passed++; }
  else {
    failed++;
    failures.push(`${label}\n      expected ${expected}\n      actual   ${actual}\n      tol      ${tol}`);
  }
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}  =  ${actual.toPrecision(6)}  (expect ${Number(expected).toPrecision(6)})`);
}

function assert(cond, label) {
  if (cond) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; failures.push(label); console.log(`  [FAIL] ${label}`); }
}

function section(t) { console.log(`\n${t}\n${'-'.repeat(t.length)}`); }

// Verify KCL: sum of currents leaving every non-ground node is zero.
function checkKCL(netlist, res, tol, label) {
  const inject = {};
  for (const id of netlist.nodes) inject[id] = 0;
  for (const e of netlist.elements) {
    const i = res.currents[e.id];
    if (i === undefined) continue;
    if (e.kind === 'vsource' || e.kind === 'short') {
      // Solver reports delivered current: flows out of b, into a
      inject[e.a] -= i;
      inject[e.b] += i;
    } else {
      inject[e.a] += i;   // current leaves a
      inject[e.b] -= i;   // and arrives at b
    }
  }
  let worst = 0, worstNode = null;
  for (const id of netlist.nodes) {
    if (id === netlist.ground) continue;
    if (Math.abs(inject[id]) > worst) { worst = Math.abs(inject[id]); worstNode = id; }
  }
  approx(worst, 0, tol, `${label} — KCL residual (worst node: ${worstNode})`);
}

const LED = (id, a, b) => ({ id, kind: 'diode', a, b, vf: 2.0, iRated: 0.02, n: 2.0 });
const R   = (id, a, b, r) => ({ id, kind: 'resistor', a, b, resistance: r });
const V   = (id, a, b, v, rint = 0) => ({ id, kind: 'vsource', a, b, voltage: v, resistance: rint });

console.log('MNA solver correctness suite');
console.log('============================');

// ── 1. Ohm's law ─────────────────────────────────────────────
section('1. Single resistor across an ideal 9V source');
{
  const net = {
    nodes: ['gnd', 'p'], ground: 'gnd',
    elements: [ V('BAT', 'p', 'gnd', 9), R('R1', 'p', 'gnd', 220) ],
  };
  const res = MNA.solve(net);
  // I = V/R = 9/220 = 0.0409090909... A
  approx(res.voltages.p, 9.0, VTOL, 'node p voltage');
  approx(res.currents.R1, 9 / 220, ITOL, 'I through R1');
  approx(res.currents.BAT, 9 / 220, ITOL, 'battery delivered current');
  checkKCL(net, res, ITOL, 'ohms-law');
}

// ── 2. Voltage divider ───────────────────────────────────────
//  The old engine has no node-voltage concept at all, so this
//  circuit is simply not expressible in it.
section('2. Voltage divider — 9V across 1k + 2k');
{
  const net = {
    nodes: ['gnd', 'p', 'mid'], ground: 'gnd',
    elements: [
      V('BAT', 'p', 'gnd', 9),
      R('R1', 'p', 'mid', 1000),
      R('R2', 'mid', 'gnd', 2000),
    ],
  };
  const res = MNA.solve(net);
  // Vmid = 9 * 2000/3000 = 6.0 V exactly;  I = 9/3000 = 3 mA
  approx(res.voltages.mid, 6.0, VTOL, 'divider midpoint');
  approx(res.currents.R1, 0.003, ITOL, 'series current');
  approx(res.currents.R2, 0.003, ITOL, 'same current through R2');
  checkKCL(net, res, ITOL, 'divider');
}

// ── 3. Parallel resistors ────────────────────────────────────
section('3. Two 220R in parallel across 9V');
{
  const net = {
    nodes: ['gnd', 'p'], ground: 'gnd',
    elements: [
      V('BAT', 'p', 'gnd', 9),
      R('R1', 'p', 'gnd', 220),
      R('R2', 'p', 'gnd', 220),
    ],
  };
  const res = MNA.solve(net);
  // Req = 110R -> Itot = 81.8181..mA, each branch 40.909..mA
  approx(res.currents.R1, 9 / 220, ITOL, 'branch 1');
  approx(res.currents.R2, 9 / 220, ITOL, 'branch 2');
  approx(res.currents.BAT, 9 / 110, ITOL, 'total from battery');
  checkKCL(net, res, ITOL, 'parallel-R');
}

// ── 4. Loaded source / internal resistance ───────────────────
section('4. Real 9V cell (1R internal) into a 10R load');
{
  const net = {
    nodes: ['gnd', 'p'], ground: 'gnd',
    elements: [ V('BAT', 'p', 'gnd', 9, 1.0), R('RL', 'p', 'gnd', 10) ],
  };
  const res = MNA.solve(net);
  // I = 9/(1+10) = 0.8181..A ; terminal V = 9 - I*1 = 8.1818..V
  approx(res.currents.RL, 9 / 11, ITOL, 'load current');
  approx(res.voltages.p, 9 * 10 / 11, VTOL, 'sagged terminal voltage');
  checkKCL(net, res, ITOL, 'loaded-source');
}

// ── 5. THE CASE THE OLD ENGINE GETS WRONG ────────────────────
//  One shared 220R feeding two parallel LEDs.
//
//  Old engine: enumerates 2 paths, each path independently gets
//  I = (9 - 2.0)/220 = 31.8 mA, and reports that for BOTH LEDs.
//  Total implied current 63.6 mA, which is twice what the single
//  shared resistor can actually pass. It double counts the
//  resistor because it never solves the two branches together.
//
//  Truth: the LEDs share the resistor, so the pair draws ~31.8 mA
//  total and each LED gets about half.
section('5. Shared resistor feeding two parallel LEDs');
{
  const net = {
    nodes: ['gnd', 'p', 'x'], ground: 'gnd',
    elements: [
      V('BAT', 'p', 'gnd', 9),
      R('R1', 'p', 'x', 220),
      LED('D1', 'x', 'gnd'),
      LED('D2', 'x', 'gnd'),
    ],
  };
  const res = MNA.solve(net);
  assert(res.converged, 'Newton-Raphson converged');
  checkKCL(net, res, ITOL, 'shared-R-parallel-LED');

  const iR  = res.currents.R1;
  const iD1 = res.currents.D1;
  const iD2 = res.currents.D2;
  console.log(`      R1  = ${(iR  * 1000).toFixed(3)} mA`);
  console.log(`      D1  = ${(iD1 * 1000).toFixed(3)} mA`);
  console.log(`      D2  = ${(iD2 * 1000).toFixed(3)} mA`);
  console.log(`      Vx  = ${res.voltages.x.toFixed(4)} V`);

  approx(iD1 + iD2, iR, ITOL, 'LED currents sum to the resistor current');
  approx(iD1, iD2, ITOL, 'identical LEDs split evenly');
  assert(iD1 < iR, 'each LED carries LESS than the shared resistor current');

  // What the old engine would have claimed for each LED:
  const legacyPerLED = (9 - 2.0) / 220;
  const err = (legacyPerLED - iD1) / iD1 * 100;
  console.log(`      legacy engine per-LED claim = ${(legacyPerLED*1000).toFixed(3)} mA`);
  console.log(`      legacy overstates each LED by ${err.toFixed(1)}%`);
  assert(err > 50, 'legacy engine overstates per-LED current by >50%');
}

// ── 6. Reverse-biased LED must stay dark ─────────────────────
//  The old engine has no polarity check anywhere in findAllPaths,
//  so it lights a backwards LED. This is the header comment's
//  documented behaviour that was never implemented.
section('6. Reverse-biased LED');
{
  const net = {
    nodes: ['gnd', 'p', 'x'], ground: 'gnd',
    elements: [
      V('BAT', 'p', 'gnd', 9),
      R('R1', 'p', 'x', 220),
      LED('D1', 'gnd', 'x'),        // cathode toward the supply
    ],
  };
  const res = MNA.solve(net);
  const i = Math.abs(res.currents.D1);
  console.log(`      reverse current = ${(i * 1e9).toExponential(3)} nA`);
  assert(i < 1e-6, 'reverse current below 1 uA (LED is dark)');
  assert(i < 0.001, 'below the 1mA light-up threshold');
  checkKCL(net, res, ITOL, 'reverse-LED');
}

// ── 7. Forward LED with series resistor ──────────────────────
section('7. 9V -> 220R -> LED -> gnd');
{
  const net = {
    nodes: ['gnd', 'p', 'x'], ground: 'gnd',
    elements: [
      V('BAT', 'p', 'gnd', 9),
      R('R1', 'p', 'x', 220),
      LED('D1', 'x', 'gnd'),
    ],
  };
  const res = MNA.solve(net);
  const i = res.currents.D1;
  const vd = res.voltages.x;
  console.log(`      I = ${(i*1000).toFixed(3)} mA,  Vf = ${vd.toFixed(4)} V`);
  assert(res.converged, 'converged');
  approx(res.currents.R1, i, ITOL, 'series current is consistent');
  // Vf must land near the rated 2.0V knee, and the loop must obey KVL
  assert(vd > 1.7 && vd < 2.4, 'LED sits on its knee (1.7V < Vf < 2.4V)');
  approx((9 - vd) / 220, i, ITOL, 'KVL: (9 - Vf)/220 equals the LED current');
  assert(i < 9 / 220, 'current is below the resistor-only ceiling');
  checkKCL(net, res, ITOL, 'forward-LED');
}

// ── 8. Short circuit is finite and physical ──────────────────
section('8. Dead short across a real cell');
{
  const net = {
    nodes: ['gnd', 'p'], ground: 'gnd',
    elements: [ V('BAT', 'p', 'gnd', 9, 1.0), R('W', 'p', 'gnd', 0.01) ],
  };
  const res = MNA.solve(net);
  // I = 9/(1 + 0.01) = 8.9108..A — large but finite, and reportable
  approx(res.currents.W, 9 / 1.01, 1e-7, 'short-circuit current');
  assert(res.currents.W > 1.0, 'flagged as a dangerous current (>1A)');
  checkKCL(net, res, ITOL, 'short');
}

// ── 9. Closed switch as an ideal 0V source ───────────────────
section('9. Button closed (ideal short in MNA border)');
{
  const net = {
    nodes: ['gnd', 'p', 'x'], ground: 'gnd',
    elements: [
      V('BAT', 'p', 'gnd', 9),
      R('R1', 'p', 'x', 220),
      { id: 'SW', kind: 'short', a: 'x', b: 'gnd' },
    ],
  };
  const res = MNA.solve(net);
  approx(res.voltages.x, 0, VTOL, 'switch node pulled to ground');
  approx(res.currents.R1, 9 / 220, ITOL, 'full current through R1');
  checkKCL(net, res, ITOL, 'closed-switch');
}

// ── 10. Floating node does not blow up the matrix ────────────
section('10. Unconnected node (gmin keeps the matrix solvable)');
{
  const net = {
    nodes: ['gnd', 'p', 'orphan'], ground: 'gnd',
    elements: [ V('BAT', 'p', 'gnd', 9), R('R1', 'p', 'gnd', 220) ],
  };
  const res = MNA.solve(net);
  assert(res.ok, 'solver did not report singular');
  approx(res.voltages.orphan, 0, 1e-6, 'floating node resolves to 0V');
}

// ── 11. Ladder network, exact analytic answer ────────────────
section('11. R-ladder — three-node exact solve');
{
  //  9V - 100 - A - 200 - B - 300 - gnd,  with 600 from A to gnd
  //  R(B->gnd) = 300; branch A: 200+300 = 500 || 600 = 272.7272..
  //  Total = 100 + 272.7272.. = 372.7272..
  //  Itot = 9/372.7272.. = 0.0241463... A
  //  VA = 9 - Itot*100 = 6.5853658... V
  const net = {
    nodes: ['gnd', 'p', 'A', 'B'], ground: 'gnd',
    elements: [
      V('BAT', 'p', 'gnd', 9),
      R('R1', 'p', 'A', 100),
      R('R2', 'A', 'B', 200),
      R('R3', 'B', 'gnd', 300),
      R('R4', 'A', 'gnd', 600),
    ],
  };
  const res = MNA.solve(net);
  const Req  = 100 + 1 / (1 / 600 + 1 / 500);
  const Itot = 9 / Req;
  const VA   = 9 - Itot * 100;
  const VB   = VA * 300 / 500;
  approx(res.voltages.A, VA, VTOL, 'V(A)');
  approx(res.voltages.B, VB, VTOL, 'V(B)');
  approx(res.currents.BAT, Itot, ITOL, 'total current');
  checkKCL(net, res, ITOL, 'ladder');
}

// ── Summary ──────────────────────────────────────────────────
console.log(`\n${'='.repeat(46)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(46));
if (failed) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
