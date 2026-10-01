// backend/ai-providers.js: the Gemini call's timeout and retry, and the
// providers that stand in for it. No network: fetch is faked.
// Run with:  node --test

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { makeProvider, geminiProvider, fixtureProvider, recordFixtures, transcript, parseAgentJSON } = require('../backend/ai-providers.js');

const TURN = { role: 'model', parts: [{ functionCall: { name: 'delete_all', args: {} }, thoughtSignature: 'abc' }] };
const CONTENTS = [{ role: 'user', parts: [{ text: 'Build an LED circuit' }] }];

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// Answers from `script` in order and records every request.
function fakeFetch(...script) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const next = script.shift();
    return typeof next === 'function' ? next(init) : next;
  };
  f.calls = calls;
  return f;
}

const provider = (fetchImpl, extra) => geminiProvider(Object.assign({
  apiKey: 'k-123', model: 'gemini-flash-latest', systemPrompt: 'Be Sparky.', tools: [],
  fetchImpl, retryDelayMs: 1,
}, extra));

test('the key travels in a header, never in the URL', async () => {
  const f = fakeFetch(reply(200, { candidates: [{ content: TURN }] }));
  await provider(f)(CONTENTS);
  assert.equal(f.calls.length, 1);
  assert.ok(!f.calls[0].url.includes('k-123'), f.calls[0].url);
  assert.equal(f.calls[0].init.headers['x-goog-api-key'], 'k-123');
  const body = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(body.contents, CONTENTS);
  assert.equal(body.system_instruction.parts[0].text, 'Be Sparky.');
});

test("the model's turn comes back untouched, thought signature included", async () => {
  const f = fakeFetch(reply(200, { candidates: [{ content: TURN, finishReason: 'STOP' }] }));
  assert.deepEqual(await provider(f)(CONTENTS), TURN);
});

test('a 503 is retried once, then the answer is used', async () => {
  const f = fakeFetch(reply(503, { error: 'overloaded' }), reply(200, { candidates: [{ content: TURN }] }));
  assert.deepEqual(await provider(f)(CONTENTS), TURN);
  assert.equal(f.calls.length, 2);
});

test('a 429 twice gives up after one retry', async () => {
  const f = fakeFetch(reply(429, { error: 'quota' }), reply(429, { error: 'quota' }), reply(200, {}));
  await assert.rejects(provider(f)(CONTENTS), /Gemini 429/);
  assert.equal(f.calls.length, 2);
});

test('a 400 is not retried', async () => {
  const f = fakeFetch(reply(400, { error: 'bad request' }), reply(200, { candidates: [{ content: TURN }] }));
  await assert.rejects(provider(f)(CONTENTS), /Gemini 400/);
  assert.equal(f.calls.length, 1);
});

test('a network failure is retried once', async () => {
  const f = fakeFetch(() => { throw new TypeError('fetch failed'); }, reply(200, { candidates: [{ content: TURN }] }));
  assert.deepEqual(await provider(f)(CONTENTS), TURN);
});

test('a call that hangs is cut off by the timeout, and not retried', async () => {
  const hang = init => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const f = fakeFetch(hang, reply(200, { candidates: [{ content: TURN }] }));
  const started = Date.now();
  await assert.rejects(provider(f, { timeoutMs: 50 })(CONTENTS), /no answer within/);
  assert.ok(Date.now() - started < 2000);
  assert.equal(f.calls.length, 1);
});

test('the request deadline shortens the timeout', async () => {
  const f = fakeFetch(reply(200, { candidates: [{ content: TURN }] }));
  await assert.rejects(provider(f)(CONTENTS, { deadline: Date.now() - 1 }), /out of time/);
  assert.equal(f.calls.length, 0);
});

test('a blocked answer becomes a polite refusal', async () => {
  const f = fakeFetch(reply(200, { candidates: [{ finishReason: 'SAFETY' }] }));
  const turn = await provider(f)(CONTENTS);
  assert.match(turn.parts[0].text, /can't help with that/);
});

test('the Claude CLI sees the whole conversation, tool calls and answers included', () => {
  const text = transcript([
    { role: 'user', parts: [{ text: 'Build it' }] },
    { role: 'model', parts: [{ functionCall: { name: 'place_led', args: { holeA: 'e9', holeB: 'e7' } } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'place_led', response: { result: 'checked, not applied' } } }, { text: 'It is backwards.' }] },
  ]);
  assert.equal(text, 'User: Build it\n\n' +
    'Assistant: (called place_led {"holeA":"e9","holeB":"e7"})\n\n' +
    'User: (place_led answered {"result":"checked, not applied"})\nIt is backwards.');
});

test('the Claude CLI runs its own model, not the Gemini one, and its JSON becomes a model turn', async () => {
  let args = null;
  const execFileImpl = (cmd, a, opts, done) => {
    args = a;
    setImmediate(() => done(null, '{"reply": "Built.", "actions": [{"tool": "place_led", "holeA": "e9", "holeB": "e7"}]}', ''));
    return { stdin: { end() {} } };
  };
  const generate = makeProvider('claude', { apiKey: '', model: 'gemini-flash-latest', systemPrompt: 'Be Sparky.', tools: [], execFileImpl });
  const turn = await generate(CONTENTS);
  assert.equal(args[args.indexOf('--model') + 1], process.env.CLAUDE_MODEL || 'sonnet');
  assert.deepEqual(turn, { role: 'model', parts: [
    { text: 'Built.' },
    { functionCall: { name: 'place_led', args: { holeA: 'e9', holeB: 'e7' } } },
  ] });
});

test('an agent reply with no text stays empty, for the checked build to word', () => {
  assert.deepEqual(parseAgentJSON('{"actions": [{"tool": "delete_all"}]}'), { reply: '', actions: [{ tool: 'delete_all' }] });
});

test('a recorded conversation replays turn for turn, whatever its thought signatures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparky-fixtures-'));
  try {
    const live = recordFixtures(async () => TURN, 'gemini', dir);
    assert.deepEqual(await live(CONTENTS), TURN);
    const replay = fixtureProvider({ fixtureDir: dir });
    assert.deepEqual(await replay(CONTENTS), TURN);
    // the same repair turn, with a different signature on the model's part
    const repair = CONTENTS.concat([Object.assign({}, TURN, { parts: [Object.assign({}, TURN.parts[0], { thoughtSignature: 'other' })] })]);
    await live(CONTENTS.concat([TURN]));
    assert.deepEqual(await replay(repair), TURN);
    await assert.rejects(replay([{ role: 'user', parts: [{ text: 'never recorded' }] }]), /No fixture/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
