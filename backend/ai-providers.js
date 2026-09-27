// ─────────────────────────────────────────────────────────────
//  ai-providers.js: pluggable backends for /api/ask
//
//  Selected with the AI_PROVIDER env var:
//
//    gemini   (default)  the real Google API. Needs GEMINI_API_KEY.
//    claude              runs the local Claude Code CLI headlessly.
//                        No API key, no quota. ~10-60s per call.
//    fixture             replays recorded turns from disk.
//                        Instant and deterministic, for tests.
//
//  Every provider is one function, generate(contents, { deadline }),
//  that takes a Gemini-style conversation and resolves to the
//  model's turn, { role: 'model', parts }. verify.js drives it, so
//  the repair turns work the same way on all three.
//
//  Recording fixtures:
//    AI_PROVIDER=claude RECORD_FIXTURES=1 node server.js
//  ...then replay them forever with AI_PROVIDER=fixture, no key needed.
// ─────────────────────────────────────────────────────────────

'use strict';

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'ask');
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 120000);
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const BLOCKED_REPLY = "I can't help with that request. Try asking about building a circuit!";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── Gemini ───────────────────────────────────────────────────
// One fetch, bounded by a timeout that also covers reading the body.
async function fetchOnce(url, init, waitMs, fetchImpl) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), waitMs);
  try {
    const res = await fetchImpl(url, Object.assign({}, init, { signal: ctl.signal }));
    if (res.ok) return { data: await res.json() };
    // The body can carry quota detail, so it goes to the log, never the user.
    const error = new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return { error, retry: res.status === 429 || res.status >= 500 };
  } catch (e) {
    if (ctl.signal.aborted) return { error: new Error(`Gemini gave no answer within ${Math.round(waitMs / 1000)} s`), retry: false };
    return { error: e, retry: true };                       // the network, not the model
  } finally {
    clearTimeout(timer);
  }
}

// A 429 or 5xx is usually gone a second later, so it gets one retry.
// A timeout does not: waiting as long again would leave the user
// staring at the typing dots.
async function postWithRetry(url, init, o) {
  for (let attempt = 1; ; attempt++) {
    const waitMs = Math.min(o.timeoutMs, (o.deadline || Infinity) - Date.now());
    if (!(waitMs > 0)) throw new Error('Gemini: out of time for this request');
    const r = await fetchOnce(url, init, waitMs, o.fetchImpl);
    if (r.data) return r.data;
    if (!r.retry || attempt === 2) throw r.error;
    await sleep(o.retryDelayMs);
  }
}

function geminiProvider({ apiKey, model, systemPrompt, tools, fetchImpl = fetch,
                          timeoutMs = 40000, retryDelayMs = 1000 }) {
  const url = `${GEMINI_BASE}${encodeURIComponent(model)}:generateContent`;
  return async function generate(contents, opts = {}) {
    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools,
      tool_config: { function_calling_config: { mode: 'AUTO' } },
      // Thinking tokens count against this cap, and a full build is a
      // long list of calls, so it sits well above what a reply needs.
      generation_config: { temperature: 0.3, max_output_tokens: 8192 },
    });
    // The key goes in a header so it never appears in a URL or a log line.
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body };
    const data = await postWithRetry(url, init, { fetchImpl, timeoutMs, retryDelayMs, deadline: opts.deadline });

    const cand = data.candidates && data.candidates[0];
    if (!cand || cand.finishReason === 'SAFETY' || (data.promptFeedback && data.promptFeedback.blockReason)) {
      return { role: 'model', parts: [{ text: BLOCKED_REPLY }] };
    }
    // Returned untouched: a repair turn has to send the model's parts
    // back as they came, thought signatures included.
    return { role: 'model', parts: (cand.content && cand.content.parts) || [] };
  };
}

// ── Tool description, derived from the tool schema ───────────
// Built from the real schema rather than hand-copied, so it cannot
// drift the way the duplicated prompt in circuit3d/index.html did.
function describeTools(circuitTools) {
  const decls = (circuitTools && circuitTools[0] && circuitTools[0].function_declarations) || [];
  return decls.map(d => {
    const props = (d.parameters && d.parameters.properties) || {};
    const names = Object.keys(props);
    const sig = names.length ? `{${names.join(', ')}}` : '{}';
    return `- ${d.name}${sig}: ${d.description || ''}`;
  }).join('\n');
}

function claudeSystemPrompt(systemPrompt, circuitTools) {
  return [
    systemPrompt,
    '',
    'AVAILABLE TOOLS:',
    describeTools(circuitTools),
    '',
    'OUTPUT FORMAT (strict):',
    'Reply with a single JSON object and nothing else. No prose outside it, no markdown fence.',
    '{"reply": "<one or two sentences for the user>", "actions": [{"tool": "<tool name>", ...args}]}',
    'If the user asked a question rather than requesting a build, return an empty actions array.',
  ].join('\n');
}

// ── Claude Code provider ─────────────────────────────────────
// The CLI takes one prompt, so the conversation is flattened to text,
// tool calls and their answers included.
function transcript(contents) {
  return (contents || []).map(c => {
    const text = (c.parts || []).map(p => {
      if (typeof p.text === 'string') return p.text;
      if (p.functionCall) return `(called ${p.functionCall.name} ${JSON.stringify(p.functionCall.args || {})})`;
      if (p.functionResponse) return `(${p.functionResponse.name} answered ${JSON.stringify(p.functionResponse.response)})`;
      return '';
    }).filter(Boolean).join('\n');
    return `${c.role === 'model' ? 'Assistant' : 'User'}: ${text}`;
  }).join('\n\n');
}

// The reply and actions as a model turn, the shape Gemini returns.
function toTurn(reply, actions) {
  const parts = reply ? [{ text: reply }] : [];
  for (const a of actions) {
    const args = Object.assign({}, a);
    delete args.tool;
    parts.push({ functionCall: { name: a.tool, args } });
  }
  return { role: 'model', parts };
}

function claudeProvider({ systemPrompt, tools, model = CLAUDE_MODEL, timeoutMs = CLAUDE_TIMEOUT_MS }) {
  const system = claudeSystemPrompt(systemPrompt, tools);
  return function generate(contents) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'claude',
        ['-p', transcript(contents), '--append-system-prompt', system, '--model', model],
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            return reject(new Error(`claude CLI failed: ${err.message}${stderr ? ` | ${stderr.trim()}` : ''}`));
          }
          try {
            const { reply, actions } = parseAgentJSON(stdout);
            resolve(toTurn(reply, actions));
          } catch (e) {
            reject(new Error(`claude CLI returned unparseable output: ${e.message}`));
          }
        }
      );
      // The CLI waits ~3s for piped stdin otherwise, and prints a warning
      // into stdout that breaks JSON parsing.
      child.stdin.end();
    });
  };
}

// ── Shared parser ────────────────────────────────────────────
// An empty reply stays empty: verify.js words it from the checked build.
function parseAgentJSON(raw) {
  let text = String(raw || '').trim();

  // Strip a markdown fence if the model added one anyway.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  // Tolerate leading noise (CLI warnings) by starting at the first brace.
  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);

  const parsed = JSON.parse(text);

  // Accept either the object form or a bare action array.
  const rawActions = Array.isArray(parsed) ? parsed : (parsed.actions || []);
  const actions = rawActions.map(a => {
    if (a.tool) return a;                                   // already our shape
    const { name, args, ...rest } = a;                      // {name, args} shape
    return { tool: name, ...(args || {}), ...rest };
  }).filter(a => a.tool);

  const reply = Array.isArray(parsed) ? '' : (parsed.reply || '');
  return { reply: String(reply).trim(), actions };
}

// ── Fixture provider ─────────────────────────────────────────
// The same conversation must always map to the same file. Thought
// signatures differ from run to run and say nothing about the request.
function fixtureKey(contents) {
  const norm = JSON.stringify((contents || []).map(c => ({
    role: c.role,
    parts: (c.parts || []).map(p => {
      const q = Object.assign({}, p);
      delete q.thoughtSignature;
      return q;
    }),
  })));
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

function fixtureProvider({ fixtureDir = FIXTURE_DIR } = {}) {
  return async function generate(contents) {
    const file = path.join(fixtureDir, `${fixtureKey(contents)}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(
        `No fixture for this request (${path.basename(file)}). ` +
        'Record one with AI_PROVIDER=claude RECORD_FIXTURES=1, or AI_PROVIDER=gemini RECORD_FIXTURES=1.'
      );
    }
    return JSON.parse(fs.readFileSync(file, 'utf8')).turn;
  };
}

function recordFixtures(generate, provider, fixtureDir = FIXTURE_DIR) {
  return async function recording(contents, opts) {
    const turn = await generate(contents, opts);
    try {
      fs.mkdirSync(fixtureDir, { recursive: true });
      const key = fixtureKey(contents);
      fs.writeFileSync(path.join(fixtureDir, `${key}.json`),
        JSON.stringify({ recorded_by: provider, contents, turn }, null, 2));
      console.log(`[fixture] recorded ${key}.json via ${provider}`);
    } catch (e) {
      console.warn('[fixture] could not record:', e.message);
    }
    return turn;
  };
}

// ── Dispatcher ───────────────────────────────────────────────
// ctx: { apiKey, model, systemPrompt, tools } for gemini, the prompt
// and tools for claude, nothing for fixture.
function makeProvider(name, ctx) {
  const provider = String(name || 'gemini').toLowerCase();
  if (provider === 'fixture') return fixtureProvider(ctx);
  const generate = provider === 'claude' ? claudeProvider(ctx) : geminiProvider(ctx);
  return process.env.RECORD_FIXTURES === '1' ? recordFixtures(generate, provider) : generate;
}

module.exports = {
  makeProvider, geminiProvider, claudeProvider, fixtureProvider, recordFixtures,
  parseAgentJSON, fixtureKey, describeTools, transcript,
};
