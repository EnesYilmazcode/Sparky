// board-model.js: ids, one lead per hole, and replaying AI actions.
// Run with:  node --test

const test   = require('node:test');
const assert = require('node:assert');

const BM  = require('../circuit3d/js/board-model.js');
const Sim = require('../circuit3d/js/simulate.js');

// What the model actually returned for "build an LED circuit" on 2026-09-27:
// the resistor, the LED and both rail wires share holes a5, a9 and a11.
const RECIPE = [
  { tool: 'delete_all' },
  { tool: 'place_battery' },
  { tool: 'add_wire', from: 'battery_0_pin0', to: 'tp_5', color: 'red' },
  { tool: 'add_wire', from: 'battery_0_pin1', to: 'tn_11', color: 'black' },
  { tool: 'place_resistor', holeA: 'a5', holeB: 'a9' },
  { tool: 'place_led', holeA: 'a11', holeB: 'a9' },
  { tool: 'add_wire', from: 'tp_5', to: 'a5', color: 'red' },
  { tool: 'add_wire', from: 'a11', to: 'tn_11', color: 'black' },
];

test('ids count per type, in placement order', () => {
  const { board } = BM.applyActions(BM.emptyBoard(), [
    { tool: 'place_resistor', holeA: 'a1', holeB: 'a5' },
    { tool: 'place_battery' },
    { tool: 'place_led', holeA: 'c8', holeB: 'c6' },
    { tool: 'place_led', holeA: 'c12', holeB: 'c10' },
  ]);
  assert.deepEqual(BM.idsOf(board), ['resistor_0', 'battery_0', 'led_0', 'led_1']);
  assert.equal(BM.findComponent(board, 'led_1'), 3);
  assert.equal(BM.findComponent(board, 'battery_0'), 1);
  assert.equal(BM.findComponent(board, 'led_2'), -1);
});

test('a lead aimed at a taken hole moves along its strip, never into another', () => {
  const r = BM.applyActions(BM.emptyBoard(), RECIPE);
  assert.deepEqual(r.errors, []);
  const [bat, res, led] = r.board.components;
  assert.equal(bat.type, 'battery');
  assert.deepEqual(res.holes.map(BM.formatHole), ['a5', 'a9']);
  // the LED moves down one row with both leads, off the resistor's hole
  assert.deepEqual(led.holes.map(BM.formatHole), ['b11', 'b9']);
  const holes = [];
  r.board.components.forEach(c => (c.holes || []).forEach(h => holes.push(BM.formatHole(h))));
  r.board.wires.forEach(w => [w.from, w.to].forEach(e => e.hole && holes.push(BM.formatHole(e.hole))));
  assert.equal(new Set(holes).size, holes.length, 'every hole holds one thing: ' + holes.join(' '));
  // the LED, and three wire ends: tp_5 and tn_11 are each used twice, a5 holds the resistor
  assert.equal(r.notes.length, 4, r.notes.join(' | '));
});

test('the relocated build is the same circuit: the LED lights at (9-2)/470', () => {
  const { board } = BM.applyActions(BM.emptyBoard(), RECIPE);
  const { components, wires } = BM.toSim(board, Sim.PROPS);
  const out = Sim.analyze(components, wires);
  assert.equal(out.ledsOn.length, 1, out.lines.map(l => l.text).join(' | '));
  assert.ok(Math.abs(out.branches[0].current * 1000 - 14.894) < 0.01);
});

test('model-supplied values ride along, and bad ones fall back', () => {
  const r = BM.applyActions(BM.emptyBoard(), [
    { tool: 'place_resistor', holeA: 'a1', holeB: 'a5', resistance: 330 },
    { tool: 'place_led', holeA: 'c8', holeB: 'c6', color: 'Green' },
    { tool: 'place_led', holeA: 'c12', holeB: 'c10', color: 'ultraviolet' },
  ]);
  assert.equal(r.board.components[0].values.resistance, 330);
  assert.equal(r.board.components[1].values.color, 'green');
  assert.equal(r.board.components[2].values.color, 'red');
});

test('diagonal parts and parts in the rails are refused, not guessed at', () => {
  const r = BM.applyActions(BM.emptyBoard(), [
    { tool: 'place_resistor', holeA: 'a1', holeB: 'c5' },
    { tool: 'place_led', holeA: 'tp_3', holeB: 'tp_5' },
    { tool: 'place_led', holeA: 'a1', holeB: 'z9' },
  ]);
  assert.equal(r.board.components.length, 0);
  assert.equal(r.errors.length, 3);
});

test('removing the battery takes its pin wires, and ids close up', () => {
  const { board } = BM.applyActions(BM.emptyBoard(), RECIPE);
  const r = BM.applyActions(board, [{ tool: 'remove_component', id: 'battery_0' }]);
  assert.equal(r.board.components.length, 2);
  assert.equal(r.board.wires.length, 2);            // the two rail-to-body wires remain
  assert.deepEqual(BM.idsOf(r.board), ['resistor_0', 'led_0']);
});

test('export round-trips, including battery pin wires', () => {
  const { board } = BM.applyActions(BM.emptyBoard(), RECIPE);
  const ex = BM.toExport(board);
  assert.equal(ex.wires[0].from, 'battery_0_pin0');
  const back = BM.toExport(BM.fromExport(ex));
  assert.deepEqual(back, ex);
});

test('a wire to an on-board pin lands beside the lead, on the same strip', () => {
  const r = BM.applyActions(BM.emptyBoard(), [
    { tool: 'place_led', holeA: 'c8', holeB: 'c6' },
    { tool: 'add_wire', from: 'led_0_pin0', to: 'tn_8' },
  ]);
  assert.deepEqual(r.errors, []);
  const w = r.board.wires[0];
  assert.equal(BM.stripOf(w.from.hole), 'top_7');
  assert.notEqual(BM.formatHole(w.from.hole), 'c8');
});
