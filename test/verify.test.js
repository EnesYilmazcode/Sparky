// backend/verify.js: every build the model proposes is checked in the
// real simulator, and what is wrong is said in words.
// Run with:  node --test

const test   = require('node:test');
const assert = require('node:assert');

const BM = require('../circuit3d/js/board-model.js');
const { answer, checkBuild } = require('../backend/verify.js');

const POWER = [
  { tool: 'delete_all' },
  { tool: 'place_battery' },
  { tool: 'add_wire', from: 'battery_0_pin0', to: 'tp_1', color: 'red' },
  { tool: 'add_wire', from: 'battery_0_pin1', to: 'tn_1', color: 'black' },
];

// One LED at column c: rail wire, resistor, LED, ground wire, one lead per hole.
function led(c, extra) {
  return [
    { tool: 'add_wire', from: `tp_${c}`, to: `a${c}`, color: 'red' },
    { tool: 'place_resistor', holeA: `c${c}`, holeB: `c${c + 4}` },
    Object.assign({ tool: 'place_led', holeA: `e${c + 6}`, holeB: `e${c + 4}` }, extra),
    { tool: 'add_wire', from: `a${c + 6}`, to: `tn_${c + 6}`, color: 'black' },
  ];
}

// What the old prompt taught, with the LED turned round: the resistor,
// the LED and both rail wires all aim at a5, a9 and a11.
const STACKED_BACKWARDS = [
  { tool: 'delete_all' },
  { tool: 'place_battery' },
  { tool: 'add_wire', from: 'battery_0_pin0', to: 'tp_5', color: 'red' },
  { tool: 'add_wire', from: 'battery_0_pin1', to: 'tn_11', color: 'black' },
  { tool: 'place_resistor', holeA: 'a5', holeB: 'a9' },
  { tool: 'place_led', holeA: 'a9', holeB: 'a11' },
  { tool: 'add_wire', from: 'tp_5', to: 'a5', color: 'red' },
  { tool: 'add_wire', from: 'a11', to: 'tn_11', color: 'black' },
];

const empty = () => BM.emptyBoard();

test('a working LED build passes, with the current it draws', () => {
  const r = checkBuild(empty(), POWER.concat(led(3)));
  const v = r.verification;
  assert.equal(v.ok, true, v.problems.join(' | '));
  assert.equal(v.summary, 'Checked in the simulator: the red LED lights at 14.9 mA.');
  assert.deepEqual(v.leds, [{ id: 'led_0', on: true, mA: 14.9, needsPress: false }]);
  assert.deepEqual(r.notes, []);
  assert.equal(v.shorted, false);
  assert.ok(v.lines.some(l => l.includes('LED ON')), v.lines.join(' | '));
  // resolved actions carry the filled-in values the editor replays
  assert.deepEqual(r.actions.find(a => a.tool === 'place_resistor'), { tool: 'place_resistor', holeA: 'c3', holeB: 'c7', resistance: 470 });
  assert.deepEqual(r.actions.find(a => a.tool === 'place_led'), { tool: 'place_led', holeA: 'e9', holeB: 'e7', color: 'red' });
});

test('a backwards LED is named as backwards, after the stacked leads move', () => {
  const r = checkBuild(empty(), STACKED_BACKWARDS);
  const v = r.verification;
  assert.equal(v.ok, false);
  assert.equal(r.notes.length, 4, r.notes.join(' | '));
  assert.match(v.problems[0], /^led_0 \(red LED, cathode b9, anode b11\) stays dark: it is in backwards/);
  assert.equal(v.summary, 'Checked in the simulator: the red LED stays dark because it is in backwards.');
});

test('a missing ground wire is named: the cathode is not connected to ground', () => {
  const r = checkBuild(empty(), POWER.concat(led(3).slice(0, 3)));
  const v = r.verification;
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /cathode \(holeA, e9\) has no path to ground/);
  assert.equal(v.summary, 'Checked in the simulator: the red LED stays dark because its cathode is not connected to ground.');
  assert.deepEqual(v.leds, [{ id: 'led_0', on: false, mA: 0, needsPress: false }]);
});

test('an unwired battery terminal is the reason, not every LED on the board', () => {
  const r = checkBuild(empty(), POWER.slice(0, 3).concat(led(3), led(11)));
  const v = r.verification;
  assert.equal(v.ok, false);
  assert.deepEqual(v.problems, ['battery_0_pin1 (-) is not wired to anything, so current has no way back to the battery.']);
  assert.equal(v.summary, "Checked in the simulator: nothing turns on because the battery's - terminal is not wired to the board.");
});

test('a button circuit is open until pressed, and counts as working', () => {
  const r = checkBuild(empty(), POWER.concat([
    { tool: 'add_wire', from: 'tp_3', to: 'a3', color: 'red' },
    { tool: 'place_button', holeA: 'c3', holeB: 'c6' },
    { tool: 'place_resistor', holeA: 'd6', holeB: 'd10' },
    { tool: 'place_led', holeA: 'e12', holeB: 'e10', color: 'green' },
    { tool: 'add_wire', from: 'a12', to: 'tn_12', color: 'black' },
  ]));
  const v = r.verification;
  assert.equal(v.ok, true, v.problems.join(' | '));
  assert.deepEqual(v.leds, [{ id: 'led_0', on: true, mA: 14.5, needsPress: true }]);
  assert.equal(v.summary, 'Checked in the simulator: the green LED lights at 14.5 mA when you press the button.');
  assert.ok(v.lines.includes('With the button pressed:'), v.lines.join(' | '));
});

test('two LEDs, each with its own resistor, both light', () => {
  const r = checkBuild(empty(), POWER.concat(led(3), led(11)));
  const v = r.verification;
  assert.equal(v.ok, true, v.problems.join(' | '));
  assert.equal(v.summary, 'Checked in the simulator: both LEDs light (14.9 mA each).');
  assert.deepEqual(v.leds.map(l => l.id), ['led_0', 'led_1']);
});

test('an LED straight across the battery is a short', () => {
  const r = checkBuild(empty(), POWER.concat([
    { tool: 'add_wire', from: 'tp_3', to: 'a3', color: 'red' },
    { tool: 'place_led', holeA: 'c5', holeB: 'c3' },
    { tool: 'add_wire', from: 'a5', to: 'tn_5', color: 'black' },
  ]));
  const v = r.verification;
  assert.equal(v.ok, false);
  assert.equal(v.shorted, true);
  assert.deepEqual(v.problems, ['Short circuit: led_0 sits straight across the battery with no resistor in series.']);
});

test('a wire from + to - is a short, even though the solver gives up on it', () => {
  const r = checkBuild(empty(), POWER.concat([{ tool: 'add_wire', from: 'tp_3', to: 'tn_3', color: 'red' }]));
  assert.equal(r.verification.shorted, true);
  assert.match(r.verification.summary, /short circuit, because wires join the battery's \+ straight to its -/);
});

test('an LED over its current rating fails, with the resistor it needs', () => {
  const build = POWER.concat(led(3));
  build[5] = Object.assign({}, build[5], { resistance: 100 });
  const v = checkBuild(empty(), build).verification;
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /^led_0 gets 70\.0 mA, over its 20 mA limit\. Put at least 350 ohm in series/);
});

test('a buzzer the wrong way round is called backwards, not quiet', () => {
  const r = checkBuild(empty(), POWER.concat([
    { tool: 'add_wire', from: 'tp_3', to: 'a3', color: 'red' },
    { tool: 'place_buzzer', holeA: 'c5', holeB: 'c3' },
    { tool: 'add_wire', from: 'a5', to: 'tn_5', color: 'black' },
  ]));
  assert.match(r.verification.problems[0], /^buzzer_0 \(buzzer, \+ c5, - c3\) stays silent: it is in backwards/);
});

test('a step that cannot be placed fails the check even when the rest works', () => {
  const r = checkBuild(empty(), POWER.concat(led(3), [{ tool: 'place_led', holeA: 'z1', holeB: 'a3' }]));
  const v = r.verification;
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /^action 9 \(place_led\)/);
  assert.equal(v.summary, 'Checked in the simulator: one step could not be placed on the board.');
});

test('an empty board, and a board with no outputs, are fine', () => {
  assert.equal(checkBuild(empty(), [{ tool: 'delete_all' }]).verification.summary,
               'Checked in the simulator: the board is empty.');
  const v = checkBuild(empty(), [{ tool: 'place_resistor', holeA: 'a1', holeB: 'a5' }]).verification;
  assert.equal(v.ok, true);
  assert.deepEqual(v.leds, []);
});

test('edits apply to the board the user already has', () => {
  const start = BM.applyActions(empty(), POWER.concat(led(3))).board;
  const r = checkBuild(start, led(11, { color: 'blue' }));
  const v = r.verification;
  assert.equal(v.ok, true, v.problems.join(' | '));
  assert.deepEqual(v.leds.map(l => [l.id, l.on]), [['led_0', true], ['led_1', true]]);
  assert.equal(v.summary, 'Checked in the simulator: both LEDs light (14.9 and 12.3 mA).');
});

// ── The ask, check and repair loop, against a stub model ─────

// A model turn the way Gemini returns one: optional text, then one
// functionCall part per action, each carrying a thought signature.
function modelTurn(actions, text) {
  const parts = text ? [{ text }] : [];
  actions.forEach((a, i) => {
    const args = Object.assign({}, a);
    delete args.tool;
    parts.push({ functionCall: { name: a.tool, args }, thoughtSignature: 'sig' + i });
  });
  return { role: 'model', parts };
}

// Replays `turns` in order and keeps a copy of every conversation it was sent.
function stub(...turns) {
  const seen = [];
  const generate = async contents => {
    seen.push(JSON.parse(JSON.stringify(contents)));
    const next = turns.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('the stub model ran out of turns');
    return next;
  };
  generate.seen = seen;
  return generate;
}

const EMPTY_EXPORT = { components: [], wires: [] };

test('a backwards build goes back to the model, and the fixed one is returned', async () => {
  const generate = stub(
    modelTurn(STACKED_BACKWARDS, 'Here is your LED circuit, it will light right up!'),
    modelTurn(POWER.concat(led(3))));
  const out = await answer({ generate, message: 'Build a complete working LED circuit from scratch', history: [], board: EMPTY_EXPORT });

  assert.equal(out.verification.attempts, 2);
  assert.equal(out.verification.ok, true);
  assert.deepEqual(out.actions, [
    { tool: 'delete_all' },
    { tool: 'place_battery', slot: 0 },
    { tool: 'add_wire', from: 'battery_0_pin0', to: 'tp_1', color: 'red' },
    { tool: 'add_wire', from: 'battery_0_pin1', to: 'tn_1', color: 'black' },
    { tool: 'add_wire', from: 'tp_3', to: 'a3', color: 'red' },
    { tool: 'place_resistor', holeA: 'c3', holeB: 'c7', resistance: 470 },
    { tool: 'place_led', holeA: 'e9', holeB: 'e7', color: 'red' },
    { tool: 'add_wire', from: 'a9', to: 'tn_9', color: 'black' },
  ]);
  assert.deepEqual(out.notes, []);
  // The second build came without text, and the first build's claim is not repeated.
  assert.equal(out.reply, 'I built it from scratch with a 9V battery, a 470 ohm resistor, a red LED and 4 wires. ' +
                          'My first try failed the simulator check (the red LED stays dark because it is in backwards). ' +
                          'Checked in the simulator: the red LED lights at 14.9 mA.');

  // The repair: the model's own turn sent back untouched, then one
  // function response per call and the problem in words.
  const convo = generate.seen[1];
  const [mine, fix] = convo.slice(-2);
  assert.equal(mine.role, 'model');
  assert.equal(mine.parts[1].thoughtSignature, 'sig0');
  assert.equal(fix.role, 'user');
  const responses = fix.parts.filter(p => p.functionResponse);
  assert.deepEqual(responses.map(p => p.functionResponse.name), STACKED_BACKWARDS.map(a => a.tool));
  const words = fix.parts[fix.parts.length - 1].text;
  assert.match(words, /led_0 \(red LED, cathode b9, anode b11\) stays dark: it is in backwards/);
  assert.match(words, /Send the complete corrected build again/);
});

test('a build that never works returns the best try and says plainly what is wrong', async () => {
  const noGround = POWER.concat(led(3).slice(0, 3));
  const generate = stub(modelTurn(noGround, 'Done, it works!'), modelTurn(noGround, 'Fixed!'), modelTurn(noGround, 'Fixed now!'));
  const out = await answer({ generate, message: 'Build an LED circuit', board: EMPTY_EXPORT });

  assert.equal(out.verification.attempts, 3);
  assert.equal(out.verification.ok, false);
  assert.equal(generate.seen.length, 3);
  assert.equal(out.reply, 'I tried 3 times but could not get this circuit working. ' +
    'Checked in the simulator: the red LED stays dark because its cathode is not connected to ground. ' +
    'You can still apply it and fix that by hand, or ask me to try again.');
});

test('the best failed try is the one with the most working outputs', async () => {
  const oneOfTwo = POWER.concat(led(3), led(11).slice(0, 3));
  const noneOfTwo = POWER.concat(led(3).slice(0, 3), led(11).slice(0, 3));
  const generate = stub(modelTurn(noneOfTwo), modelTurn(oneOfTwo), modelTurn(noneOfTwo));
  const out = await answer({ generate, message: 'Two LEDs please', board: EMPTY_EXPORT });
  assert.equal(out.verification.attempts, 3);
  assert.deepEqual(out.verification.leds.map(l => l.on), [true, false]);
  assert.match(out.verification.summary, /the second LED stays dark because its cathode is not connected to ground/);
});

test('a button circuit passes on the first try, and the reply keeps the model text', async () => {
  const generate = stub(modelTurn(POWER.concat([
    { tool: 'add_wire', from: 'tp_3', to: 'a3', color: 'red' },
    { tool: 'place_button', holeA: 'c3', holeB: 'c6' },
    { tool: 'place_resistor', holeA: 'd6', holeB: 'd10' },
    { tool: 'place_led', holeA: 'e12', holeB: 'e10' },
    { tool: 'add_wire', from: 'a12', to: 'tn_12', color: 'black' },
  ]), 'Press the button to light the LED.'));
  const out = await answer({ generate, message: 'Build a circuit with a push button that turns an LED on', board: EMPTY_EXPORT });
  assert.equal(out.verification.attempts, 1);
  assert.equal(out.verification.ok, true);
  assert.equal(out.verification.leds[0].needsPress, true);
  assert.match(out.verification.summary, /lights at 14\.9 mA when you press the button/);
  assert.equal(out.reply, 'Press the button to light the LED.');
});

test('a reply written from the build names the parts', async () => {
  const lights = POWER.concat(led(3, { color: 'red' }), led(11, { color: 'yellow' }), led(19, { color: 'green' }));
  lights[5] = Object.assign({}, lights[5], { resistance: 820 });
  const out = await answer({ generate: stub(modelTurn(lights)), message: 'Build a traffic light', board: EMPTY_EXPORT });
  assert.match(out.reply, /^I built it from scratch with a 9V battery, 3 resistors, 3 LEDs \(red, yellow and green\) and 8 wires\. /);
  const one = await answer({ generate: stub(modelTurn(POWER.concat(led(3)).map(a => (a.tool === 'place_resistor' ? Object.assign({}, a, { resistance: 820 }) : a)))), message: 'Build it', board: EMPTY_EXPORT });
  assert.match(one.reply, /an 820 ohm resistor/);
});

test('a pure question gets words only, and no verification', async () => {
  const generate = stub({ role: 'model', parts: [{ text: 'A resistor limits the current through the LED.' }] });
  const out = await answer({ generate, message: 'What does a resistor do?', board: EMPTY_EXPORT });
  assert.deepEqual(out, { reply: 'A resistor limits the current through the LED.', actions: [], notes: [], verification: null });
  assert.equal(generate.seen.length, 1);
});

test('removing a part is checked but not repaired: the user asked for it', async () => {
  const board = BM.toExport(BM.applyActions(BM.emptyBoard(), POWER.concat(led(3))).board);
  const generate = stub(modelTurn([{ tool: 'remove_component', id: 'resistor_0' }]));
  const out = await answer({ generate, message: 'Remove the resistor', board });
  assert.equal(generate.seen.length, 1);
  assert.equal(out.verification.ok, false);
  assert.equal(out.reply, 'I removed resistor_0. Checked in the simulator: the red LED stays dark because its anode is not connected to the + side.');
});

test('a repair that cannot reach the model keeps the build it has', async () => {
  const noGround = POWER.concat(led(3).slice(0, 3));
  const generate = stub(modelTurn(noGround), new Error('Gemini 503'));
  const out = await answer({ generate, message: 'Build an LED circuit', board: EMPTY_EXPORT });
  assert.equal(out.verification.attempts, 1);
  assert.equal(out.actions.length, 7);
  assert.match(out.reply, /stays dark because its cathode is not connected to ground\. Ask me to fix it, or fix it by hand\.$/);
});

test('the first call failing is an error for the server to report', async () => {
  const generate = stub(new Error('Gemini 503'));
  await assert.rejects(answer({ generate, message: 'hi', board: EMPTY_EXPORT }), /Gemini 503/);
});

test('the model sees the board with per-type ids and the simulator view of it', async () => {
  const board = BM.toExport(BM.applyActions(BM.emptyBoard(), POWER.concat(led(3))).board);
  const generate = stub({ role: 'model', parts: [{ text: 'It works.' }] });
  await answer({ generate, message: 'Will my circuit work?', board });
  const text = generate.seen[0][0].parts[0].text;
  assert.match(text, /- battery_0: 9V battery, off the board \(battery_0_pin0 is \+, battery_0_pin1 is -\)/);
  assert.match(text, /- led_0: red LED, cathode e9, anode e7/);
  assert.match(text, /- battery_0_pin0 to tp_1 \(red\)/);
  assert.match(text, /SIMULATOR CHECK OF THE CURRENT BOARD: the red LED lights at 14\.9 mA\./);
  assert.match(text, /MESSAGE: Will my circuit work\?$/);
});

test('an old client with no board still works, and its markdown reaches the model', async () => {
  const generate = stub(modelTurn(POWER.concat(led(3))));
  const out = await answer({ generate, message: 'Build an LED circuit', history: [], markdown: '**Board status: EMPTY**' });
  assert.equal(out.verification.ok, true);
  assert.match(generate.seen[0][0].parts[0].text, /^CURRENT BOARD:\n\*\*Board status: EMPTY\*\*/);
});

test('history opens with the user and alternates', async () => {
  const generate = stub({ role: 'model', parts: [{ text: 'ok' }] });
  await answer({ generate, message: 'and now?', board: EMPTY_EXPORT, history: [
    { role: 'model', text: 'Hi, I am Sparky.' },
    { role: 'user', text: 'hello' },
    { role: 'user', text: 'are you there?' },
    { role: 'model', text: 'Yes.' },
    { role: 'user', text: '' },
  ] });
  const convo = generate.seen[0];
  assert.deepEqual(convo.map(t => t.role), ['user', 'model', 'user']);
  assert.deepEqual(convo[0].parts.map(p => p.text), ['hello', 'are you there?']);
});

test('a malformed board is refused as a bad request, not a crash', async () => {
  const generate = stub();
  for (const board of ['nope', [], { components: 'x' }, { components: [{ type: 'led', holes: 'a1' }] }]) {
    await assert.rejects(answer({ generate, message: 'hi', board }), e => e.code === 'BAD_BOARD');
  }
});
