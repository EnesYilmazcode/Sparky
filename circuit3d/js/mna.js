// ─────────────────────────────────────────────────────────────
//  mna.js — Modified Nodal Analysis DC solver
//
//  A real circuit solver. Same method SPICE uses.
//
//  WHAT THIS REPLACES
//  ──────────────────
//  The old engine enumerated every path from battery+ to battery−
//  and evaluated each one in isolation as I = (V - ΣVf) / ΣR.
//  That is not circuit analysis. It has no concept of a node
//  voltage, it double counts any element shared between branches,
//  and it cannot represent a divider, a loaded source, or a
//  reverse biased diode.
//
//  WHAT THIS DOES INSTEAD
//  ──────────────────────
//  Solves Kirchhoff's Current Law at every node simultaneously.
//
//    [ G  B ] [ v ]   [ i ]
//    [ C  D ] [ j ] = [ e ]
//
//  G  (n×n)  node conductance matrix
//  B  (n×m)  voltage source incidence, C = Bᵀ, D = 0
//  v  (n)    unknown node voltages
//  j  (m)    unknown currents through voltage sources
//  i  (n)    known current injections
//  e  (m)    known source voltages
//
//  n = non-ground nodes, m = voltage sources. The "modified" in
//  MNA is the B/C border: an ideal voltage source has no
//  conductance to stamp, so its current becomes an extra unknown.
//
//  Diodes (LEDs) are nonlinear, so the system is solved by
//  Newton-Raphson: linearize each diode about its present
//  operating point into a companion model (a conductance in
//  parallel with a current source), solve the linear system,
//  repeat until the node voltages stop moving.
//
//  Two diode models are available per element:
//
//    'shockley'  I  = Is·(exp(V/(N·Vt)) − 1)          exponential, real
//                Geq = dI/dV = Is/(N·Vt)·exp(V/(N·Vt))
//                Ieq = I − Geq·V
//
//    'pwl'       ideal switch with a fixed forward drop: conducting
//                above Vf with a small Ron, open below it. This is
//                the standard first-order LED model and is what the
//                simulator uses, because a constant 2.0V drop is the
//                number a breadboard teaching tool should show.
//
//  Both are solved by the same Newton loop. Only the companion model
//  differs; KCL is enforced at every node either way, which is the
//  part the old path-walking engine got wrong.
//
//  Runs in the browser and in Node (for the test suite).
//
//  Exports: MNA.solve(netlist)
// ─────────────────────────────────────────────────────────────

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MNA = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  'use strict';

  // ── Physical constants ──────────────────────────────────────
  const VT      = 0.025852;   // thermal voltage kT/q at 300K
  const GMIN    = 1e-12;      // shunt conductance to ground on every
                              // node, keeps the matrix non singular
                              // when part of the board is floating
  const MAX_ITER   = 100;     // Newton-Raphson iteration cap
  const V_TOL      = 1e-7;    // node voltage convergence, volts
  const I_TOL      = 1e-12;   // branch current convergence, amps
  const V_CRIT_CAP = 0.9;     // per-iteration voltage step limiter
  const D_RON      = 1e-3;    // PWL diode on-resistance, ohms
  const D_ROFF     = 1e12;    // PWL diode off-resistance, ohms

  // ─────────────────────────────────────────────────────────────
  //  Dense linear solve: Gaussian elimination, partial pivoting
  //  A is destroyed. Returns x, or null if A is singular.
  // ─────────────────────────────────────────────────────────────
  function luSolve(A, b) {
    const n = b.length;
    const x = b.slice();

    for (let col = 0; col < n; col++) {
      // Partial pivot: largest magnitude in this column
      let piv = col, best = Math.abs(A[col][col]);
      for (let r = col + 1; r < n; r++) {
        const v = Math.abs(A[r][col]);
        if (v > best) { best = v; piv = r; }
      }
      if (best < 1e-18) return null;      // singular

      if (piv !== col) {
        const t = A[piv]; A[piv] = A[col]; A[col] = t;
        const s = x[piv]; x[piv] = x[col]; x[col] = s;
      }

      const d = A[col][col];
      for (let r = col + 1; r < n; r++) {
        const f = A[r][col] / d;
        if (f === 0) continue;
        for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
        x[r] -= f * x[col];
      }
    }

    // Back substitution
    for (let r = n - 1; r >= 0; r--) {
      let s = x[r];
      for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
      x[r] = s / A[r][r];
    }
    return x;
  }

  // ─────────────────────────────────────────────────────────────
  //  Diode voltage limiting.
  //
  //  exp() over a raw Newton step overflows instantly: a 1V step
  //  on a diode is e^38 times the current. SPICE's pnjlim caps
  //  the per-iteration excursion so the iteration stays on the
  //  curve instead of launching off it.
  // ─────────────────────────────────────────────────────────────
  function limitJunction(vNew, vOld, vth, vcrit) {
    if (vNew > vcrit && Math.abs(vNew - vOld) > 2 * vth) {
      if (vOld > 0) {
        const arg = 1 + (vNew - vOld) / vth;
        vNew = arg > 0
          ? vOld + vth * Math.log(arg)
          : vcrit;
      } else {
        vNew = vth * Math.log(vNew / vth);
      }
    } else if (vNew < 0) {
      // Clamp deep reverse bias; the model is flat down there anyway
      const vlim = -10 * vth;
      if (vNew < vlim) vNew = vlim;
    }
    return vNew;
  }

  // ─────────────────────────────────────────────────────────────
  //  Derive a diode saturation current from a datasheet style
  //  operating point (Vf at If), which is how LEDs are actually
  //  specified. Is is never given directly on a part.
  // ─────────────────────────────────────────────────────────────
  function saturationCurrent(vf, iRated, n) {
    return iRated / (Math.exp(vf / (n * VT)) - 1);
  }

  // ─────────────────────────────────────────────────────────────
  //  solve(netlist)
  //
  //  netlist = {
  //    nodes:    [nodeId, ...]            // ground included
  //    ground:   nodeId
  //    elements: [
  //      { id, kind:'resistor', a, b, resistance }
  //      { id, kind:'vsource',  a, b, voltage, resistance? }
  //      { id, kind:'diode',    a, b, vf, iRated, n? }   // a = anode
  //      { id, kind:'short',    a, b }                   // closed switch
  //    ]
  //  }
  //
  //  returns {
  //    ok, reason,
  //    voltages: { nodeId: volts },       // ground = 0
  //    currents: { elementId: amps },     // + flows a → b
  //    iterations, converged
  //  }
  // ─────────────────────────────────────────────────────────────
  function solve(netlist) {
    const ground   = netlist.ground;
    const elements = netlist.elements || [];

    // ── Index non-ground nodes ────────────────────────────────
    const idx = new Map();
    let n = 0;
    for (const id of netlist.nodes) {
      if (id === ground) continue;
      if (!idx.has(id)) idx.set(id, n++);
    }

    // Voltage sources take an extra unknown each. A closed switch
    // is a 0V source, which is how MNA represents an ideal short
    // without dividing by a zero resistance.
    // A source whose two terminals are the same node contributes an
    // all-zero row. A 0V one is a harmless no-op and is dropped; a
    // non-zero one is a genuine contradiction (V across a short).
    for (const e of elements) {
      if ((e.kind === 'vsource' || e.kind === 'short') && e.a === e.b && (e.voltage || 0) !== 0) {
        return { ok: false, reason: 'source-shorted', voltages: {}, currents: {},
                 iterations: 0, converged: false };
      }
    }
    const vsrc = elements.filter(e =>
      (e.kind === 'vsource' || e.kind === 'short') && e.a !== e.b);
    const m    = vsrc.length;
    const size = n + m;

    if (size === 0) {
      return { ok: false, reason: 'empty', voltages: {}, currents: {},
               iterations: 0, converged: true };
    }

    const diodes = elements.filter(e => e.kind === 'diode');

    // Precompute diode model params once
    for (const d of diodes) {
      d._model = d.model || 'shockley';
      if (d._model === 'pwl') { d._state = false; continue; }
      if (d._is === undefined) {
        d._n    = d.n || 2.0;             // LEDs run high, 1.8–3
        d._is   = saturationCurrent(d.vf, d.iRated || 0.02, d._n);
        d._vth  = d._n * VT;
        // vcrit: the knee where the exponential starts to run away
        d._vcrit = d._vth * Math.log(d._vth / (Math.SQRT2 * d._is));
      }
    }

    const row = id => (id === ground ? -1 : idx.get(id));

    // Newton-Raphson state: guess each diode just below its knee
    const vd = diodes.map(d => (d._model === 'pwl' ? d.vf : d.vf * 0.8));
    let stateChanged = false;

    let x = null, iter = 0, converged = false;

    for (iter = 1; iter <= MAX_ITER; iter++) {
      // ── Build A and z fresh each iteration ──────────────────
      const A = Array.from({ length: size }, () => new Float64Array(size));
      const z = new Float64Array(size);

      // gmin shunt on every node
      for (let i = 0; i < n; i++) A[i][i] += GMIN;

      // Linear conductances
      for (const e of elements) {
        if (e.kind !== 'resistor') continue;
        const g = 1 / Math.max(e.resistance, 1e-9);
        const a = row(e.a), b = row(e.b);
        if (a >= 0) A[a][a] += g;
        if (b >= 0) A[b][b] += g;
        if (a >= 0 && b >= 0) { A[a][b] -= g; A[b][a] -= g; }
      }

      // Diode companion models, linearized about vd[k]
      diodes.forEach((d, k) => {
        const v = vd[k];
        let geq, ieq;

        if (d._model === 'pwl') {
          // Conducting above the forward drop, open below it.
          if (d._state) { geq = 1 / D_RON;  ieq = -d.vf / D_RON; }
          else          { geq = 1 / D_ROFF; ieq = 0; }
        } else {
          const ex  = Math.exp(Math.min(v / d._vth, 80));   // guard overflow
          const id_ = d._is * (ex - 1);
          geq = Math.max(d._is / d._vth * ex, GMIN);
          ieq = id_ - geq * v;
        }

        const a = row(d.a), b = row(d.b);
        if (a >= 0) A[a][a] += geq;
        if (b >= 0) A[b][b] += geq;
        if (a >= 0 && b >= 0) { A[a][b] -= geq; A[b][a] -= geq; }
        // Companion current source points anode → cathode
        if (a >= 0) z[a] -= ieq;
        if (b >= 0) z[b] += ieq;
      });

      // Voltage sources and shorts (the MNA border)
      vsrc.forEach((e, k) => {
        const r = n + k;
        const a = row(e.a), b = row(e.b);
        if (a >= 0) { A[a][r] += 1; A[r][a] += 1; }
        if (b >= 0) { A[b][r] -= 1; A[r][b] -= 1; }
        // Series resistance on a real source lives in the D block,
        // which is what stops a dead short producing infinite current.
        if (e.kind === 'vsource') {
          z[r] = e.voltage;
          if (e.resistance) A[r][r] -= e.resistance;
        } else {
          z[r] = 0;                        // closed switch: Va − Vb = 0
        }
      });

      const sol = luSolve(A.map(r => Array.from(r)), Array.from(z));
      if (!sol) {
        return { ok: false, reason: 'singular', voltages: {}, currents: {},
                 iterations: iter, converged: false };
      }

      // ── Convergence check on diode voltages ─────────────────
      let maxDelta = 0;
      stateChanged = false;
      const nextVd = diodes.map((d, k) => {
        const va = d.a === ground ? 0 : sol[idx.get(d.a)];
        const vb = d.b === ground ? 0 : sol[idx.get(d.b)];
        let vNew = va - vb;

        if (d._model === 'pwl') {
          // A conducting diode is held at Vf, so the test for staying
          // on is whether current still wants to flow forward through
          // it, not whether the node voltage exceeds Vf.
          const iFwd  = d._state ? (vNew - d.vf) / D_RON : 0;
          const want  = d._state ? iFwd > 0 : vNew >= d.vf;
          if (want !== d._state) { d._state = want; stateChanged = true; }
        } else {
          vNew = limitJunction(vNew, vd[k], d._vth, d._vcrit);
        }

        maxDelta = Math.max(maxDelta, Math.abs(vNew - vd[k]));
        return vNew;
      });

      x = sol;
      for (let k = 0; k < diodes.length; k++) vd[k] = nextVd[k];

      if (diodes.length === 0) { converged = true; break; }
      if (!stateChanged && maxDelta < V_TOL) { converged = true; break; }
    }

    // ── Unpack ────────────────────────────────────────────────
    const voltages = { [ground]: 0 };
    for (const [id, i] of idx) voltages[id] = x[i];

    const vAt = id => (id === ground ? 0 : voltages[id]);
    const currents = {};

    for (const e of elements) {
      if (e.kind === 'resistor') {
        currents[e.id] = (vAt(e.a) - vAt(e.b)) / Math.max(e.resistance, 1e-9);
      } else if (e.kind === 'diode') {
        const v = vAt(e.a) - vAt(e.b);
        if (e._model === 'pwl') {
          currents[e.id] = e._state ? (v - e.vf) / D_RON : v / D_ROFF;
        } else {
          const ex = Math.exp(Math.min(v / e._vth, 80));
          currents[e.id] = e._is * (ex - 1);
        }
      }
    }
    vsrc.forEach((e, k) => {
      // MNA solves the source current as flowing a → b internally;
      // negate so a positive number means the source is delivering.
      currents[e.id] = -x[n + k];
    });

    return {
      ok: true,
      reason: converged ? 'converged' : 'max-iterations',
      voltages, currents,
      iterations: iter,
      converged,
    };
  }

  return { solve, VT, saturationCurrent, _luSolve: luSolve };
});
