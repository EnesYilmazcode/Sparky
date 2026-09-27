// ─────────────────────────────────────────────────────────────
//  verify.js: checks every build the model proposes in the real
//  simulator before the user sees it (issue #15), and sends one
//  that does not work back to the model to fix.
//
//  The model's tool calls go through board-model.js onto the
//  user's board, and the result runs through simulate.js, the
//  same code the editor runs. What comes back is plain enough
//  for a beginner and specific enough for the model to fix.
//
//  answer() is one whole /api/ask turn. The model is injected:
//  generate(contents, { deadline }) takes a Gemini-style
//  conversation and resolves to the model's turn,
//  { role: 'model', parts }. Tests pass a stub.
// ─────────────────────────────────────────────────────────────

'use strict';

const BoardModel = require('../circuit3d/js/board-model.js');
const Sim        = require('../circuit3d/js/simulate.js');
const MNA        = require('../circuit3d/js/mna.js');

const MAX_ATTEMPTS  = 3;      // the first build and up to two repairs
// Batteries sit off the board, so nothing else bounds how many
// solver unknowns one request can add.
const MAX_BATTERIES = 20;
const MAX_ACTIONS   = 300;
const MAX_PARTS     = 400;
const MAX_WIRES     = 800;
// Not worth starting a repair with less of the time budget left.
const REPAIR_MIN_MS = 10000;
const NO_ANSWER = 'Sorry, I did not get an answer that time. Could you ask again?';

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

const mA = amps => (amps * 1000).toFixed(1);

function joinAnd(xs) {
  return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

// ── One simulator run ────────────────────────────────────────
//  analyze() decides what lights. It works out, but does not
//  return, the current through each part and the node each lead
//  lands on, so those come from the same netlist solved again.
function simulate(board) {
  const { components, wires } = BoardModel.toSim(board, Sim.PROPS);
  const out = Sim.analyze(components, wires);
  const graph = Sim.buildGraph(components, wires);
  const battery = graph.find(g => g.comp.type === 'battery');
  let sol = null;
  if (battery) {
    const net = Sim.buildNetlist(graph);
    net.ground = battery.nodes[1];          // the reference analyze() uses
    sol = MNA.solve(net);
  }
  const solved = !!(sol && sol.ok);
  return {
    lines: out.lines.map(l => l.text),
    lit: new Set(out.ledsOn.concat(out.buzzersOn).map(c => components.indexOf(c))),
    nodes: graph.map(g => g.nodes),
    amps: i => (solved ? Math.abs(sol.currents[components[i]._simId] || 0) : 0),
    volts: node => (solved ? sol.voltages[node] || 0 : 0),
    values: i => components[i].values,
    // A source the solver cannot satisfy is a battery wired across itself.
    shorted: out.branches.some(b => b.shorted) || (!!sol && !sol.ok),
  };
}

function pressAll(board) {
  const b = JSON.parse(JSON.stringify(board));
  b.components.forEach(c => { if (c.type === 'button') c.pressed = true; });
  return b;
}

// Nodes reachable from `seed`. An LED passes current one way, so a
// walk out from + crosses it anode to cathode and a walk out from -
// crosses it cathode to anode. A pressed button is already one node.
function reach(board, sim, seed, skip, forward) {
  const seen = new Set([seed]), queue = [seed];
  while (queue.length) {
    const at = queue.shift();
    board.components.forEach((c, i) => {
      if (i === skip || c.type === 'button') return;
      const [n0, n1] = sim.nodes[i];
      let next = null;
      if (c.type === 'led') next = forward ? (n1 === at ? n0 : null) : (n0 === at ? n1 : null);
      else next = n0 === at ? n1 : n1 === at ? n0 : null;
      if (next !== null && !seen.has(next)) { seen.add(next); queue.push(next); }
    });
  }
  return seen;
}

// ── Naming outputs the way a beginner would ──────────────────
function friendly(o, outputs) {
  const same = outputs.filter(x => x.type === o.type);
  const nth = () => ORDINAL[same.indexOf(o)] || `number ${same.indexOf(o) + 1}`;
  if (o.type === 'buzzer') return same.length === 1 ? 'the buzzer' : `the ${nth()} buzzer`;
  if (same.filter(x => x.color === o.color).length === 1) return `the ${o.color} LED`;
  return `the ${nth()} LED`;
}

// ── Problems: `text` for the model and the problem list, `plain`
//    for the one-sentence summary ─────────────────────────────

function powerProblem(board, ids) {
  const bi = board.components.findIndex(c => c.type === 'battery');
  if (bi < 0) {
    return { text: 'There is no battery, so nothing gets power. Add place_battery and wire battery_0_pin0 to tp_1 and battery_0_pin1 to tn_1.',
             plain: 'nothing turns on because there is no battery' };
  }
  const id = ids[bi];
  const wired = pin => board.wires.some(w => [w.from, w.to].some(e => e.pin && e.pin.comp === bi && e.pin.pin === pin));
  if (!wired(0) && !wired(1)) {
    return { text: `${id} is not wired to the board. Wire ${id}_pin0 (+) to a tp hole and ${id}_pin1 (-) to a tn hole.`,
             plain: 'nothing turns on because the battery is not wired to the board' };
  }
  if (!wired(0)) {
    return { text: `${id}_pin0 (+) is not wired to anything, so nothing gets power.`,
             plain: "nothing turns on because the battery's + terminal is not wired to the board" };
  }
  if (!wired(1)) {
    return { text: `${id}_pin1 (-) is not wired to anything, so current has no way back to the battery.`,
             plain: "nothing turns on because the battery's - terminal is not wired to the board" };
  }
  return null;
}

function shortProblem(board, sim, ids, pressText) {
  const bi = board.components.findIndex(c => c.type === 'battery');
  const [pos, neg] = sim.nodes[bi];
  const across = board.components.findIndex((c, i) =>
    c.type === 'led' && sim.nodes[i][1] === pos && sim.nodes[i][0] === neg);
  let text, plain;
  if (pos === neg && pressText) {
    text = plain = "the button joins the battery's + straight to its -";
  } else if (pos === neg) {
    text = "wires join the battery's + straight to its - with nothing in between";
    plain = "wires join the battery's + straight to its -";
  } else if (across >= 0) {
    text = `${ids[across]} sits straight across the battery with no resistor in series`;
    plain = 'the LED sits straight across the battery with no resistor';
  } else {
    text = "a path from the battery's + to its - has too little resistance; every path needs a resistor";
    plain = 'a path from + to - has no resistor to limit the current';
  }
  const when = pressText ? ' ' + pressText : '';
  return { text: `Short circuit${when}: ${text}.`, plain: `this is a short circuit${when}, because ${plain}` };
}

// Why one LED or buzzer does not conduct, leg by leg. In the
// simulator an LED is pin0 cathode, pin1 anode, and a buzzer only
// counts as on when current runs pin0 to pin1, so its holeA is +.
function darkReason(board, sim, o, holes) {
  const led = o.type === 'led';
  const bi = board.components.findIndex(c => c.type === 'battery');
  const [pos, neg] = sim.nodes[bi];
  const [n0, n1] = sim.nodes[o.i];
  const plus = led ? n1 : n0, minus = led ? n0 : n1;
  const plusLeg  = led ? `anode (holeB, ${holes[1]})` : `+ leg (holeA, ${holes[0]})`;
  const minusLeg = led ? `cathode (holeA, ${holes[0]})` : `- leg (holeB, ${holes[1]})`;

  if (n0 === n1) {
    return { text: `both legs are on one connection (${holes[0]} and ${holes[1]} are joined), so current goes around it.`,
             plain: 'both of its legs are joined, so the current goes around it' };
  }
  const up = reach(board, sim, pos, bi, true), down = reach(board, sim, neg, bi, false);
  const plusOk = up.has(plus), minusOk = down.has(minus);
  const backwards = sim.volts(plus) - sim.volts(minus) < -0.5 ||
    (!plusOk && !minusOk && (down.has(plus) || up.has(minus)));
  if (backwards) {
    return { text: `it is in backwards. Its ${plusLeg} must face the + side, so swap holeA and holeB.`,
             plain: 'it is in backwards' };
  }
  if (plusOk && minusOk) {
    const need = (sim.values(o.i).thresholdCurrent || 0.001) * 1000;
    return { text: `it is connected, but only ${mA(o.amps)} mA flows, below the ${need} mA it needs. There is too much resistance, or too many parts in series for 9V.`,
             plain: 'too little current reaches it' };
  }
  if (!plusOk && !minusOk) {
    return { text: 'neither leg has a path to the battery.', plain: 'it is not connected to the battery' };
  }
  if (!plusOk) {
    return { text: `its ${plusLeg} has no path to the battery's + side.`,
             plain: `its ${led ? 'anode' : '+ leg'} is not connected to the + side` };
  }
  return { text: `its ${minusLeg} has no path to ground (the battery's - side).`,
           plain: `its ${led ? 'cathode' : '- leg'} is not connected to ground` };
}

function darkProblem(board, sim, o, outputs) {
  const holes = (board.components[o.i].holes || []).map(BoardModel.formatHole);
  while (holes.length < 2) holes.push('off the board');
  const where = o.type === 'led' ? `${o.color} LED, cathode ${holes[0]}, anode ${holes[1]}` : `buzzer, + ${holes[0]}, - ${holes[1]}`;
  const state = o.type === 'led' ? 'stays dark' : 'stays silent';
  const r = darkReason(board, sim, o, holes);
  return { text: `${o.id} (${where}) ${state}: ${r.text}`, plain: `${friendly(o, outputs)} ${state} because ${r.plain}` };
}

function overProblem(board, o, outputs, sim, pressText) {
  const v = sim.values(o.i);
  const amps = sim.amps(o.i);
  const battery = board.components.find(c => c.type === 'battery');
  const minR = Math.ceil(((battery ? battery.values.voltage : 9) - (v.forwardVoltage || 0)) / v.maxCurrent);
  const limit = Math.round(v.maxCurrent * 1000);
  const when = pressText ? ' ' + pressText : '';
  return {
    text: `${o.id} gets ${mA(amps)} mA${when}, over its ${limit} mA limit. Put at least ${minR} ohm in series with it.`,
    plain: `${friendly(o, outputs)} gets ${mA(amps)} mA${when}, more than its ${limit} mA limit, so it needs a bigger resistor`,
  };
}

// ── Summary of a board that works ────────────────────────────
function workingClause(board, outputs, pressText) {
  if (!board.components.length && !board.wires.length) return 'the board is empty';
  if (!outputs.length) return 'nothing is shorted, and there is no LED or buzzer to light up yet';
  const clauses = [];
  for (const type of ['led', 'buzzer']) {
    const total = outputs.filter(o => o.type === type).length;
    const verb = type === 'led' ? 'light' : 'sound';
    for (const press of [false, true]) {
      const group = outputs.filter(o => o.type === type && o.needsPress === press);
      if (!group.length) continue;
      const tail = press ? ' ' + pressText : '';
      if (group.length === 1) {
        clauses.push(`${friendly(group[0], outputs)} ${verb}s at ${mA(group[0].amps)} mA${tail}`);
        continue;
      }
      const who = group.length !== total ? `${group.length}` : total === 2 ? 'both' : `all ${total}`;
      const amps = group.map(o => mA(o.amps));
      const each = amps.every(a => a === amps[0]) ? `${amps[0]} mA each` : `${joinAnd(amps)} mA`;
      clauses.push(`${who} ${type === 'led' ? 'LEDs' : 'buzzers'} ${verb}${tail} (${each})`);
    }
  }
  return joinAnd(clauses);
}

// ── Verify a board ───────────────────────────────────────────
//  ok only when nothing failed to place, nothing is shorted, no LED
//  is over its current rating, and every LED and buzzer conducts.
//  A button circuit is open until pressed, so an output that only
//  conducts with the buttons held down still counts.
function verifyBoard(board, errors) {
  const ids = BoardModel.idsOf(board);
  const problems = (errors || []).map((e, k) => ({
    text: e,
    plain: k ? null : `${errors.length === 1 ? 'one step' : errors.length + ' steps'} could not be placed on the board`,
  }));
  const buttons = board.components.filter(c => c.type === 'button').length;
  const pressText = buttons > 1 ? 'when you press the buttons' : 'when you press the button';

  if (board.components.filter(c => c.type === 'battery').length > MAX_BATTERIES) {
    problems.push({ text: `More than ${MAX_BATTERIES} batteries is too many to check.`, plain: 'there are too many batteries to check' });
    return finish(board, problems, [], [], false, pressText);
  }

  const rest = simulate(board);
  const pressed = buttons ? simulate(pressAll(board)) : null;

  const outputs = [];
  board.components.forEach((c, i) => {
    if (c.type !== 'led' && c.type !== 'buzzer') return;
    const litRest = rest.lit.has(i);
    const litPress = !litRest && !!pressed && pressed.lit.has(i);
    const on = litRest || litPress;
    outputs.push({
      i, id: ids[i], type: c.type, color: c.values.color, on, needsPress: litPress,
      amps: on ? (litPress ? pressed : rest).amps(i) : Math.max(rest.amps(i), pressed ? pressed.amps(i) : 0),
    });
  });

  const shortSim = rest.shorted ? rest : pressed && pressed.shorted ? pressed : null;
  if (shortSim) {
    problems.push(shortProblem(board, shortSim, ids, shortSim === pressed ? pressText : ''));
  } else {
    const dark = outputs.filter(o => !o.on);
    const power = dark.length ? powerProblem(board, ids) : null;
    if (power) problems.push(power);
    else dark.forEach(o => problems.push(darkProblem(board, pressed || rest, o, outputs)));

    // An LED can be fine at rest and overloaded once a button
    // bypasses its resistor, so both runs are checked.
    outputs.filter(o => o.type === 'led').forEach(o => {
      const over = [rest, pressed].find(s => s && s.lit.has(o.i) && s.values(o.i).maxCurrent &&
                                             s.amps(o.i) > s.values(o.i).maxCurrent);
      if (over) problems.push(overProblem(board, o, outputs, over, over === pressed ? pressText : ''));
    });
  }

  let lines = rest.lines;
  if (pressed) lines = lines.concat([`With the button${buttons > 1 ? 's' : ''} pressed:`], pressed.lines);
  return finish(board, problems, outputs, lines, !!shortSim, pressText);
}

function finish(board, problems, outputs, lines, shorted, pressText) {
  const headed = problems.filter(p => p.plain);
  let summary;
  if (problems.length) {
    const more = headed.length - 1;
    summary = headed[0].plain + (more ? ` (and ${more} more problem${more > 1 ? 's' : ''})` : '');
  } else {
    summary = workingClause(board, outputs, pressText);
  }
  const pub = o => ({ id: o.id, on: o.on, mA: Math.round(o.amps * 10000) / 10, needsPress: o.needsPress });
  return {
    ok: problems.length === 0,
    summary: `Checked in the simulator: ${summary}.`,
    problems: problems.map(p => p.text),
    lines,
    leds: outputs.filter(o => o.type === 'led').map(pub),
    buzzers: outputs.filter(o => o.type === 'buzzer').map(pub),
    shorted,
    attempts: 1,
  };
}

// Applies the model's actions to the starting board and verifies the
// result. `actions` in the return value are the resolved ones, holes
// after any move, which is what the editor replays.
function checkBuild(start, actions) {
  const list = (actions || []).slice(0, MAX_ACTIONS);
  const applied = BoardModel.applyActions(start, list);
  if ((actions || []).length > MAX_ACTIONS) applied.errors.push(`Only the first ${MAX_ACTIONS} actions were used.`);
  return {
    board: applied.board,
    actions: applied.resolved,
    notes: applied.notes,
    errors: applied.errors,
    verification: verifyBoard(applied.board, applied.errors),
  };
}

// ── The conversation ─────────────────────────────────────────

// The board as the editor exported it. Old clients send none, which
// counts as an empty board.
function parseBoard(data) {
  const bad = why => Object.assign(new Error(why), { code: 'BAD_BOARD' });
  if (data == null) return BoardModel.emptyBoard();
  if (typeof data !== 'object' || Array.isArray(data)) throw bad('board must be an object');
  const components = data.components || [], wires = data.wires || [];
  if (!Array.isArray(components) || !Array.isArray(wires)) throw bad('components and wires must be lists');
  if (components.length > MAX_PARTS || wires.length > MAX_WIRES) throw bad('the board has too many parts');
  if (components.filter(c => c && c.type === 'battery').length > MAX_BATTERIES) throw bad('the board has too many batteries');
  try {
    return BoardModel.fromExport({ components, wires });
  } catch {
    throw bad('a part or wire is malformed');
  }
}

function describeBoard(board) {
  if (!board.components.length && !board.wires.length) return 'The board is empty.';
  const ex = BoardModel.toExport(board);
  const ids = BoardModel.idsOf(board);
  const lines = ['Parts:'];
  ex.components.forEach((c, i) => {
    const [a, b] = c.holes || [];
    const v = c.values || {};
    if (c.type === 'battery') lines.push(`- ${ids[i]}: ${v.voltage}V battery, off the board (${ids[i]}_pin0 is +, ${ids[i]}_pin1 is -)`);
    else if (!c.holes) lines.push(`- ${ids[i]}: ${c.type}, not on the board`);
    else if (c.type === 'led') lines.push(`- ${ids[i]}: ${v.color} LED, cathode ${a}, anode ${b}`);
    else if (c.type === 'resistor') lines.push(`- ${ids[i]}: ${v.resistance} ohm resistor, ${a} to ${b}`);
    else if (c.type === 'buzzer') lines.push(`- ${ids[i]}: buzzer, + ${a}, - ${b}`);
    else lines.push(`- ${ids[i]}: push button, ${a} to ${b}`);
  });
  if (!ex.components.length) lines.push('- none');
  lines.push('Wires:');
  ex.wires.forEach(w => lines.push(`- ${w.from} to ${w.to} (${w.color})`));
  if (!ex.wires.length) lines.push('- none');
  return lines.join('\n');
}

// The simulator's view of the current board goes along with it, so
// "will my circuit work?" is answered from the solver, not guessed.
function firstTurn(message, board, markdown) {
  const lines = ['CURRENT BOARD:'];
  if (board) {
    lines.push(describeBoard(board));
    if (board.components.length) {
      const v = verifyBoard(board, []);
      lines.push('', `SIMULATOR CHECK OF THE CURRENT BOARD: ${plain(v)}.`);
      v.problems.forEach(p => lines.push('- ' + p));
    }
  } else {
    lines.push(markdown || 'The board is empty.');
  }
  lines.push('', 'MESSAGE: ' + (message || 'Look at my circuit and tell me what to do next.'));
  return lines.join('\n');
}

function addTurn(turns, role, part) {
  const last = turns[turns.length - 1];
  if (last && last.role === role) last.parts.push(part);
  else turns.push({ role, parts: [part] });
}

// Earlier chat as text. A conversation opens with the user and roles
// alternate, so leading model turns are dropped and repeats merged.
function historyTurns(history) {
  const turns = [];
  for (const h of Array.isArray(history) ? history.slice(-20) : []) {
    if (!h || typeof h.text !== 'string' || !h.text.trim()) continue;
    const role = h.role === 'model' ? 'model' : 'user';
    if (!turns.length && role === 'model') continue;
    addTurn(turns, role, { text: h.text.slice(0, 4000) });
  }
  return turns;
}

// The model's text and actions. Replies from before tool calling put
// the actions in a fenced JSON block, which still works.
function readTurn(content) {
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const calls = parts.filter(p => p && p.functionCall).map(p => p.functionCall);
  let text = parts.filter(p => p && typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
  let actions = calls.map(c => Object.assign({}, c.args, { tool: c.name }));
  if (!calls.length) {
    const m = /```(?:actions|json)\s*([\s\S]*?)```/.exec(text);
    if (m) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (Array.isArray(parsed)) {
          actions = parsed.filter(a => a && typeof a.tool === 'string');
          text = text.slice(0, m.index).trim();
        }
      } catch { /* not actions after all */ }
    }
  }
  return { text, calls, actions };
}

// Each of the model's calls answered, then what the simulator found.
// Nothing is applied between attempts: every attempt is a complete
// build from the user's board, so the fix has to repeat every call.
function repairTurn(turn, check) {
  const parts = turn.calls.map((c, i) => {
    const err = check.errors.find(e => e.startsWith(`action ${i + 1} `));
    const fr = { name: c.name, response: err ? { error: err } : { result: 'checked, not applied' } };
    if (c.id) fr.id = c.id;
    return { functionResponse: fr };
  });
  const lines = ['SIMULATOR CHECK: that build does not work yet.'];
  check.verification.problems.forEach(p => lines.push('- ' + p));
  if (check.notes.length) lines.push('Placement notes:', ...check.notes.map(n => '- ' + n));
  lines.push(
    'Nothing was applied: the board is still as it was before your calls.',
    'Send the complete corrected build again, every call and not only the fix.',
    'The user has not seen this check, so any text should describe the finished circuit.');
  parts.push({ text: lines.join('\n') });
  return { role: 'user', parts };
}

const builds = actions => actions.some(a => /^place_/.test(a.tool) || a.tool === 'add_wire');
const working = v => v.leds.concat(v.buzzers).filter(o => o.on).length;

// The first build that works, else the one with the most working
// outputs, then the fewest problems. The sort is stable, so a tie
// goes to the earlier build.
function pickBest(tries) {
  return tries.find(t => t.check.verification.ok) || tries.slice().sort((a, b) =>
    working(b.check.verification) - working(a.check.verification) ||
    a.check.verification.problems.length - b.check.verification.problems.length)[0];
}

// "an 820 ohm resistor", "a 470 ohm resistor"
const an = n => /^8/.test(n) || /^1[18](000)*$/.test(n);

const ONE  = { battery: () => 'a 9V battery', led: a => `a ${a.color} LED`, button: () => 'a push button',
               buzzer: () => 'a buzzer', resistor: a => `${an(String(a.resistance)) ? 'an' : 'a'} ${a.resistance} ohm resistor` };
const MANY = {
  battery: n => `${n} batteries`, resistor: n => `${n} resistors`, button: n => `${n} push buttons`, buzzer: n => `${n} buzzers`,
  led: (n, list) => {
    const colors = [...new Set(list.map(a => a.color))];
    return colors.length === 1 ? `${n} ${colors[0]} LEDs` : `${n} LEDs (${joinAnd(colors)})`;
  },
};

// One sentence on what a build did, for when the model wrote none.
function describeBuild(actions) {
  const placed = new Map(), removed = [];
  let wires = 0, cleared = false;
  for (const a of actions) {
    const type = (/^place_(\w+)$/.exec(a.tool) || [])[1];
    if (ONE[type]) placed.set(type, (placed.get(type) || []).concat([a]));
    else if (a.tool === 'add_wire') wires++;
    else if (a.tool === 'delete_all') cleared = true;
    else if (a.tool === 'remove_component') removed.push(a.id);
    else if (a.tool === 'remove_wire') removed.push(`the wire from ${a.from} to ${a.to}`);
  }
  const items = [...placed].map(([type, list]) => (list.length === 1 ? ONE[type](list[0]) : MANY[type](list.length, list)));
  if (wires) items.push(wires === 1 ? 'a wire' : `${wires} wires`);
  const done = [];
  if (removed.length) done.push(`removed ${joinAnd(removed)}`);
  if (items.length) done.push(`${cleared ? 'built it from scratch with' : 'added'} ${joinAnd(items)}`);
  else if (cleared) done.push('cleared the board');
  return done.length ? `I ${joinAnd(done)}.` : '';
}

const plain = v => v.summary.replace(/^Checked in the simulator: /, '').replace(/\.$/, '');

// The model writes its text before anything is checked, so that text
// only stands when the check passed.
function composeReply(best, tries, v) {
  const built = describeBuild(best.check.actions);
  if (v.ok) {
    if (best.turn.text) return best.turn.text;
    // A fix can change what the user asked for (a 100 ohm resistor
    // becomes 470), so the reply says what the check caught.
    const caught = best === tries[0] ? '' : `My first try failed the simulator check (${plain(tries[0].check.verification)}).`;
    return [built, caught, v.summary].filter(Boolean).join(' ');
  }
  if (tries.length > 1) {
    return `I tried ${tries.length} times but could not get this circuit working. ${v.summary} ` +
           'You can still apply it and fix that by hand, or ask me to try again.';
  }
  const next = builds(best.check.actions) ? ' Ask me to fix it, or fix it by hand.' : '';
  return [built, v.summary].filter(Boolean).join(' ') + next;
}

// One /api/ask turn: ask, check every build, send a failed one back
// with its problems, and reply from the best build.
async function answer({ generate, message, history, board, markdown, deadline = Infinity }) {
  const start = parseBoard(board);
  const contents = historyTurns(history);
  addTurn(contents, 'user', { text: firstTurn(message, board == null ? null : start, markdown) });

  const tries = [];
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    let content;
    try {
      content = await generate(contents, { deadline });
    } catch (e) {
      if (!tries.length) throw e;
      console.warn(`[ask] repair ${n - 1} failed, keeping the best build so far: ${e.message}`);
      break;
    }
    const turn = readTurn(content);
    if (!turn.actions.length) {
      if (!tries.length) return { reply: turn.text || NO_ANSWER, actions: [], notes: [], verification: null };
      break;                     // a repair answered in words only
    }
    const check = checkBuild(start, turn.actions);
    tries.push({ turn, check });
    // A removal can leave a circuit dark on purpose, so only builds are repaired.
    if (check.verification.ok || !builds(turn.actions) || deadline - Date.now() < REPAIR_MIN_MS) break;
    if (n < MAX_ATTEMPTS) contents.push({ role: 'model', parts: content.parts }, repairTurn(turn, check));
  }

  const best = pickBest(tries);
  const verification = Object.assign({}, best.check.verification, { attempts: tries.length });
  return {
    reply: composeReply(best, tries, verification),
    actions: best.check.actions,
    notes: best.check.notes,
    verification,
  };
}

module.exports = { answer, checkBuild, verifyBoard, readTurn, parseBoard };
