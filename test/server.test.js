// backend/server.js end to end: a real HTTP server on an ephemeral port,
// with a stub model in place of Gemini. No network beyond localhost.
// Run with:  node --test

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('path');
const { spawn } = require('child_process');

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

test('a body over 200 KB is refused with a 413 before it is parsed', async () => {
  let asked = 0;
  const counting = async contents => { asked++; return stubModel(contents); };
  await withServer({ generate: counting, model: 'stub' }, async base => {
    const big = { message: 'Build it', board: { components: [], wires: [] }, pad: 'x'.repeat(210 * 1024) };
    const res = await post(base, big);
    assert.equal(res.status, 413);
    assert.equal((await res.json()).reply, 'That request is too large.');
    assert.equal(asked, 0);
    // a normal board export is far below the limit
    assert.equal((await post(base, { message: 'Build it', board: { components: [], wires: [] } })).status, 200);
  });
});

test('the rate limit counts each client by its first X-Forwarded-For address', async () => {
  await withServer({ generate: stubModel, model: 'stub', rateLimit: { perClient: 2, total: 5 } }, async base => {
    const ask = ip => post(base, { message: 'hi' }, { 'X-Forwarded-For': `${ip}, 10.0.0.1` }).then(r => r.status);
    assert.deepEqual([await ask('1.1.1.1'), await ask('1.1.1.1'), await ask('1.1.1.1')], [200, 200, 429]);
    assert.equal(await ask('2.2.2.2'), 200, 'another user behind the same proxy has their own count');
    // Forged addresses still run into the cap on everyone together.
    assert.deepEqual([await ask('3.3.3.3'), await ask('4.4.4.4'), await ask('5.5.5.5')], [200, 200, 429]);
  });
});

test('CORS is never a wildcard: only the app hosts and localhost get a grant', async () => {
  await withServer({ generate: stubModel, model: 'stub' }, async base => {
    const allow = async (origin, method = 'POST') => {
      const res = method === 'OPTIONS'
        ? await fetch(base + '/api/ask', { method, headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } })
        : await post(base, { message: 'hi' }, { Origin: origin });
      assert.equal(res.headers.get('vary'), 'Origin');
      return res.headers.get('access-control-allow-origin');
    };
    assert.equal(await allow('https://evil.example'), null);
    assert.equal(await allow('https://evil.example', 'OPTIONS'), null);
    assert.equal(await allow('https://sparky-na2c.onrender.com'), 'https://sparky-na2c.onrender.com');
    assert.equal(await allow('https://buildwithsparky.web.app', 'OPTIONS'), 'https://buildwithsparky.web.app');
    assert.equal(await allow('http://localhost:5173'), 'http://localhost:5173');
    assert.equal(await allow('http://localhost.evil.example'), null);
    const plain = await post(base, { message: 'hi' });                 // same origin sends no Origin
    assert.equal(plain.headers.get('access-control-allow-origin'), null);
    assert.equal(plain.status, 200);
  });
});

test('/api/ask only takes JSON, so a cross-site form post cannot skip the preflight', async () => {
  let asked = 0;
  const counting = async contents => { asked++; return stubModel(contents); };
  await withServer({ generate: counting, model: 'stub' }, async base => {
    const res = await fetch(base + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ message: 'hi' }) });
    assert.equal(res.status, 415);
    assert.equal(asked, 0);
    assert.equal((await post(base, { message: 'hi' }, { 'Content-Type': 'application/json; charset=utf-8' })).status, 200);
  });
});

test('pages and API answers carry the security headers', async () => {
  await withServer({ generate: stubModel, model: 'stub' }, async base => {
    for (const res of [await fetch(base + '/landing.html'), await post(base, { message: 'hi' }), await fetch(base + '/nope')]) {
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'self'");
    }
  });
});

// Runs `node backend/server.js` the way Render does, on a free port. Values
// set here win over backend/.env, and /api/health never calls the model.
function startMain(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'server.js')], {
      env: Object.assign({}, process.env, { AI_PROVIDER: 'gemini', RECORD_FIXTURES: '', PORT: '0' }, env),
    });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('server did not start: ' + out)); }, 10000);
    child.stdout.on('data', d => {
      out += d;
      const m = /http:\/\/localhost:(\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve({ child, base: `http://127.0.0.1:${m[1]}` }); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited with ${code}: ${out}`)); });
  });
}

test('/api/health says whether the AI is configured, and never shows the key', async () => {
  for (const [key, ai] of [['test-key-not-real', true], ['', false]]) {
    const { child, base } = await startMain({ GEMINI_API_KEY: key, GEMINI_MODEL: 'gemini-test-model' });
    try {
      const res = await fetch(base + '/api/health');
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { status: 'ok', model: 'gemini-test-model', ai });
      if (key) assert.ok(!text.includes(key));
    } finally {
      child.kill();
    }
  }
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
