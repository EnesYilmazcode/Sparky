// backend/server.js end to end: a real HTTP server on an ephemeral port,
// with a stub model in place of Gemini. No network beyond localhost.
// Run with:  node --test

const test   = require('node:test');
const assert = require('node:assert');

const BM = require('../circuit3d/js/board-model.js');
const { checkBuild } = require('../backend/verify.js');
const { createServer, SYSTEM_PROMPT, CIRCUIT_TOOLS, POWER_RECIPE, ledRecipe } = require('../backend/server.js');

const LED_BUILD = [
  ['delete_all', {}],
  ['place_battery', {}],
  ['add_wire', { from: 'battery_0_pin0', to: 'tp_1', color: 'red' }],
  ['add_wire', { from: 'battery_0_pin1', to: 'tn_1', color: 'black' }],
  ['add_wire', { from: 'tp_3', to: 'a3', color: 'red' }],
  ['place_resistor', { holeA: 'c3', holeB: 'c7' }],
  ['place_led', { holeA: 'e9', holeB: 'e7' }],
  ['add_wire', { from: 'a9', to: 'tn_9', color: 'black' }],
];
const buildTurn = { role: 'model', parts: LED_BUILD.map(([name, args]) => ({ functionCall: { name, args } })) };

// Builds for "build", words for anything else.
const stubModel = async contents => {
  const last = contents[contents.length - 1].parts.map(p => p.text || '').join('');
  return /MESSAGE: Build/.test(last) ? buildTurn : { role: 'model', parts: [{ text: 'Resistors limit current.' }] };
};

async function withServer(opts, fn) {
  const server = createServer(opts);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const post = (base, body, headers) => fetch(base + '/api/ask', {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('the recipe the prompt teaches keeps one lead per hole and lights every LED', () => {
  const at = C => ledRecipe(n => C + n);
  const r = checkBuild(BM.emptyBoard(), POWER_RECIPE.concat(at(3), at(11), at(19)));
  assert.deepEqual(r.notes, [], 'nothing had to move');
  assert.equal(r.verification.ok, true, r.verification.problems.join(' | '));
  assert.equal(r.verification.summary, 'Checked in the simulator: all 3 LEDs light (14.9 mA each).');
  assert.match(SYSTEM_PROMPT, /place_resistor holeA=c\{C\}, holeB=c\{C\+4\}/);
});

test('the tools let the model edit in place and choose values', () => {
  const decl = Object.fromEntries(CIRCUIT_TOOLS[0].function_declarations.map(d => [d.name, d]));
  assert.deepEqual(decl.remove_component.parameters.required, ['id']);
  assert.deepEqual(decl.remove_wire.parameters.required, ['from', 'to']);
  assert.equal(decl.place_resistor.parameters.properties.resistance.type, 'INTEGER');
  assert.deepEqual(decl.place_led.parameters.properties.color.enum, ['red', 'yellow', 'green', 'blue', 'white']);
});

test('/api/ask builds, checks and returns the contract the editor reads', async () => {
  await withServer({ generate: stubModel, model: 'stub' }, async base => {
    const res = await post(base, { message: 'Build an LED circuit', history: [], board: { components: [], wires: [] } });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.deepEqual(Object.keys(out).sort(), ['actions', 'notes', 'reply', 'verification']);
    assert.equal(out.actions.length, 8);
    assert.deepEqual(out.notes, []);
    assert.equal(out.verification.ok, true);
    assert.equal(out.verification.attempts, 1);
    assert.equal(out.verification.summary, 'Checked in the simulator: the red LED lights at 14.9 mA.');
    assert.deepEqual(out.verification.leds, [{ id: 'led_0', on: true, mA: 14.9, needsPress: false }]);
  });
});

test('a question gets words and a null verification; an old client without a board still works', async () => {
  await withServer({ generate: stubModel, model: 'stub' }, async base => {
    const out = await (await post(base, { message: 'What is a resistor?', markdown: '**Board status: EMPTY**', history: [] })).json();
    assert.deepEqual(out, { reply: 'Resistors limit current.', actions: [], notes: [], verification: null });
  });
});

test('bad input is a 400 in the same shape, and no model means a 503', async () => {
  await withServer({ generate: stubModel, model: 'stub' }, async base => {
    let res = await post(base, '{not json');
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(await res.json()).sort(), ['actions', 'notes', 'reply', 'verification']);
    res = await post(base, { message: 'Build it', board: { components: 'nope' } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).reply, /board could not be read/);
  });
  await withServer({ generate: null, model: 'gemini-flash-latest' }, async base => {
    const res = await post(base, { message: 'hi' });
    assert.equal(res.status, 503);
  });
});

test('a model failure is a 502 that keeps the upstream detail out of the reply', async () => {
  const failing = async () => { throw new Error('Gemini 403: API key not valid, quota project 12345'); };
  await withServer({ generate: failing, model: 'stub' }, async base => {
    const res = await post(base, { message: 'Build it' });
    assert.equal(res.status, 502);
    const out = await res.json();
    assert.doesNotMatch(out.reply, /403|quota|key/i);
  });
});

test('the static site is still served, and the removed auth and storage routes are gone', async () => {
  await withServer({ generate: stubModel, model: 'stub' }, async base => {
    const page = await fetch(base + '/circuit3d/index.html');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal((await fetch(base + '/backend/server.js')).status, 404);
    for (const route of ['/api/auth/google', '/api/auth/me', '/api/circuits']) {
      assert.equal((await fetch(base + route)).status, 404, route);
    }
  });
});
