// backend/verify.js: every build the model proposes is checked in the
// real simulator, and what is wrong is said in words.
// Run with:  node --test

const test   = require('node:test');
const assert = require('node:assert');

const BM = require('../circuit3d/js/board-model.js');
const { checkBuild } = require('../backend/verify.js');

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
