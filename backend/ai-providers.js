// ─────────────────────────────────────────────────────────────
//  ai-providers.js — pluggable backends for /api/ask
//
//  Selected with the AI_PROVIDER env var:
//
//    gemini   (default)  the real Google API. Needs GEMINI_API_KEY.
//    claude              runs the local Claude Code CLI headlessly.
//                        No API key, no quota. ~10-60s per call.
//    fixture             replays a recorded response from disk.
//                        Instant and deterministic, for tests.
//
//  Every provider returns the same { reply, actions } shape that
//  askGemini already returned, so nothing downstream changes.
//
//  Recording fixtures:
//    AI_PROVIDER=claude RECORD_FIXTURES=1 node server.js
//  ...then replay them forever with AI_PROVIDER=fixture, no key needed.
// ─────────────────────────────────────────────────────────────

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'ask');
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 120000);

// ── Fixture key ──────────────────────────────────────────────
// Same request must always map to the same file. History is included
// because a follow-up turn is a different request.
function fixtureKey(markdown, userMsg, history) {
  const norm = JSON.stringify({
    markdown: markdown || '',
    userMsg: userMsg || '',
    history: (history || []).map(h => ({ role: h.role, text: h.text })),
  });
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

// ── Tool description, derived from CIRCUIT_TOOLS ─────────────
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
    'OUTPUT FORMAT — this is strict:',
    'Reply with a single JSON object and nothing else. No prose outside it, no markdown fence.',
    '{"reply": "<one or two sentences for the user>", "actions": [{"tool": "<tool name>", ...args}]}',
    'If the user asked a question rather than requesting a build, return an empty actions array.',
  ].join('\n');
}

// ── Claude Code provider ─────────────────────────────────────
function askClaude(markdown, userMsg, history, ctx) {
  const msg = userMsg || 'Analyze my circuit and tell me what to do next.';
  const boardState = markdown || '**Board is EMPTY — no components or wires placed.**';

  const priorTurns = (history || [])
    .filter(h => h && h.text)
    .map(h => `${h.role === 'model' ? 'Assistant' : 'User'}: ${h.text}`)
    .join('\n');

  const prompt = [
    priorTurns ? `CONVERSATION SO FAR:\n${priorTurns}\n` : '',
    `BOARD STATE:\n${boardState}`,
    '',
    `QUESTION: ${msg}`,
  ].join('\n');

  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', prompt,
       '--append-system-prompt', claudeSystemPrompt(ctx.SYSTEM_PROMPT, ctx.CIRCUIT_TOOLS),
       '--model', CLAUDE_MODEL],
      { timeout: CLAUDE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          return reject(new Error(`claude CLI failed: ${err.message}${stderr ? ` | ${stderr.trim()}` : ''}`));
        }
        try {
          resolve(parseAgentJSON(stdout));
        } catch (e) {
          reject(new Error(`claude CLI returned unparseable output: ${e.message}`));
        }
      }
    );
    // The CLI waits ~3s for piped stdin otherwise, and prints a warning
    // into stdout that breaks JSON parsing.
    child.stdin.end();
  });
}

// ── Shared parser ────────────────────────────────────────────
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

  let reply = Array.isArray(parsed) ? '' : (parsed.reply || '');
  if (!reply) {
    reply = actions.length
      ? "Here you go! I've built the circuit for you. Hit Run Simulation to test it out!"
      : '(no response)';
  }
  return { reply: String(reply).trim(), actions };
}

// ── Fixture provider ─────────────────────────────────────────
function fixturePath(key) {
  return path.join(FIXTURE_DIR, `${key}.json`);
}

async function askFixture(markdown, userMsg, history) {
  const key = fixturePath(fixtureKey(markdown, userMsg, history));
  if (!fs.existsSync(key)) {
    throw new Error(
      `No fixture for this request (${path.basename(key)}). ` +
      'Record one with AI_PROVIDER=claude RECORD_FIXTURES=1, or AI_PROVIDER=gemini RECORD_FIXTURES=1.'
    );
  }
  const saved = JSON.parse(fs.readFileSync(key, 'utf8'));
  return { reply: saved.reply, actions: saved.actions || [] };
}

function recordFixture(markdown, userMsg, history, result, provider) {
  try {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    const key = fixtureKey(markdown, userMsg, history);
    fs.writeFileSync(fixturePath(key), JSON.stringify({
      recorded_by: provider,
      request: { markdown: markdown || '', userMsg: userMsg || '', history: history || [] },
      reply: result.reply,
      actions: result.actions,
    }, null, 2));
    console.log(`[fixture] recorded ${key}.json via ${provider}`);
  } catch (e) {
    console.warn('[fixture] could not record:', e.message);
  }
}

// ── Dispatcher ───────────────────────────────────────────────
// askGemini is injected so this module does not need the key or the
// fetch logic, which keeps the existing code path untouched.
function makeAsk(askGemini, ctx) {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  return async function ask(markdown, userMsg, history) {
    if (provider === 'fixture') {
      return askFixture(markdown, userMsg, history);
    }

    const result = provider === 'claude'
      ? await askClaude(markdown, userMsg, history, ctx)
      : await askGemini(markdown, userMsg, history);

    if (process.env.RECORD_FIXTURES === '1') {
      recordFixture(markdown, userMsg, history, result, provider);
    }
    return result;
  };
}

module.exports = { makeAsk, parseAgentJSON, fixtureKey, describeTools };
