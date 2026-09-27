/**
 * Sparky backend: Node 18+, zero npm dependencies, CommonJS.
 *
 * Run from backend/:  node server.js
 *
 * POST /api/ask     { message, history, board, markdown }
 *                   -> { reply, actions, notes, verification }
 * GET  /api/health  -> { status, model }
 *
 * Everything else is the static site from the repo root. Sign-in and saved
 * circuits live in Firebase Auth and Firestore, called from the pages, so
 * this server holds no user data.
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const BoardModel = require('../circuit3d/js/board-model.js');
const { makeProvider } = require('./ai-providers');
const { answer } = require('./verify');

// ── Load .env ─────────────────────────────────────────────────
function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    raw.split('\n').forEach(line => {
      const eq = line.indexOf('=');
      if (eq < 1) return;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k && !(k in process.env)) process.env[k] = v;
    });
  } catch { /* .env optional */ }
}

// ── The tutor's instructions ─────────────────────────────────
// The one-LED build the prompt teaches, at column c(0). The prompt
// prints it with symbolic columns and the tests build it for real,
// so the recipe cannot drift into one that breaks a rule.
function ledRecipe(c) {
  return [
    { tool: 'add_wire', from: `tp_${c(0)}`, to: `a${c(0)}`, color: 'red' },
    { tool: 'place_resistor', holeA: `c${c(0)}`, holeB: `c${c(4)}` },
    { tool: 'place_led', holeA: `e${c(6)}`, holeB: `e${c(4)}` },
    { tool: 'add_wire', from: `a${c(6)}`, to: `tn_${c(6)}`, color: 'black' },
  ];
}

const POWER_RECIPE = [
  { tool: 'delete_all' },
  { tool: 'place_battery' },
  { tool: 'add_wire', from: 'battery_0_pin0', to: 'tp_1', color: 'red' },
  { tool: 'add_wire', from: 'battery_0_pin1', to: 'tn_1', color: 'black' },
];

function recipeLine(a) {
  if (a.tool === 'add_wire') return `add_wire ${a.from} -> ${a.to} (${a.color})`;
  if (a.tool === 'place_led') return `place_led holeA=${a.holeA} (cathode), holeB=${a.holeB} (anode)`;
  if (a.holeA) return `${a.tool} holeA=${a.holeA}, holeB=${a.holeB}`;
  return a.tool;
}

const SYSTEM_PROMPT = [
  'You are Sparky, a friendly electronics tutor. Beginners build circuits on a virtual breadboard, and you help by explaining and by calling tools that change their board.',
  '',
  'THE BOARD',
  '- Columns 1-50. Rows a-e are the top half, rows f-j the bottom half.',
  '- A strip is the 5 holes of one column in one half: a7, b7, c7, d7 and e7 are connected. a7 and f7 are not; the center gap splits them.',
  '- The rails run the whole length: every tp hole is one connection, every tn hole another. Nothing reaches a rail until it is wired to it.',
  '- One lead or wire end per hole. To join two things, put them in different holes of the same strip.',
  '',
  'PARTS',
  '- Ids count per type in placement order: the first LED is led_0, the second led_1, the first battery battery_0.',
  '- The 9V battery sits off the board: battery_0_pin0 is +, battery_0_pin1 is -. Wire + to tp_1 and - to tn_1, which makes tp the + rail and tn the - rail.',
  '- LED: holeA is the cathode (-, toward tn), holeB the anode (+, toward tp). Every LED needs a resistor in series.',
  '- Buzzer: holeA is + (toward tp), holeB is -.',
  '- A part lies along one row: a resistor spans 4 columns (c3 to c7), an LED or buzzer 2, a button 3.',
  '',
  'ONE LED AT COLUMN C (C = 3 for the first LED)',
  ...POWER_RECIPE.concat(ledRecipe(n => (n ? `{C+${n}}` : '{C}'))).map(a => '  ' + recipeLine(a)),
  'Each extra LED repeats the last four steps at C = 11, 19, 27 and so on, with its own resistor.',
  'A button or buzzer goes in series the same way: each lead in a free hole of the strip it connects to.',
  '',
  'CHANGING THE BOARD',
  '- A new circuit, or starting over: delete_all, then the full build.',
  "- A small change to the user's circuit: edit it in place with remove_component, remove_wire and the place and add tools, and keep their other parts.",
  '- Every build is checked in a circuit simulator before the user sees it.',
  '',
  'REPLIES',
  '- Short, friendly and plain: 1 to 3 sentences for a beginner.',
  '- If the user only asks a question, answer it and call no tools.',
].join('\n');

// ── Gemini function declarations ─────────────────────────────
const hole = description => ({ type: 'STRING', description });
const twoHoles = (a, b, extra) => ({
  type: 'OBJECT',
  properties: Object.assign({ holeA: hole(a), holeB: hole(b) }, extra),
  required: ['holeA', 'holeB'],
});

const CIRCUIT_TOOLS = [{
  function_declarations: [
    {
      name: 'delete_all',
      description: 'Remove every part and wire. Call it first for a new circuit or to start over.',
    },
    {
      name: 'place_battery',
      description: 'Add a 9V battery off the board. Then wire battery_N_pin0 (+) to a tp hole and battery_N_pin1 (-) to a tn hole.',
    },
    {
      name: 'place_resistor',
      description: 'Place a resistor along one row, holes 4 columns apart.',
      parameters: twoHoles('First hole, e.g. "c3"', 'Second hole, e.g. "c7"', {
        resistance: { type: 'INTEGER', description: 'Ohms. The default 470 suits one LED on 9V.' },
      }),
    },
    {
      name: 'place_led',
      description: 'Place an LED along one row, holes 2 columns apart. holeA is the cathode (-), holeB the anode (+).',
      parameters: twoHoles('Cathode (-) hole, e.g. "e9"', 'Anode (+) hole, e.g. "e7"', {
        color: { type: 'STRING', enum: BoardModel.LED_COLORS, description: 'Default red.' },
      }),
    },
    {
      name: 'place_buzzer',
      description: 'Place a buzzer along one row, holes 2 columns apart. holeA is + and holeB is -.',
      parameters: twoHoles('+ hole, e.g. "c3"', '- hole, e.g. "c5"'),
    },
    {
      name: 'place_button',
      description: 'Place a push button along one row, holes 3 columns apart. It connects them only while pressed.',
      parameters: twoHoles('First hole, e.g. "c3"', 'Second hole, e.g. "c6"'),
    },
    {
      name: 'add_wire',
      description: 'Add a wire between two points: body holes ("a3"), rail holes ("tp_5", "tn_5") or battery pins ("battery_0_pin0").',
      parameters: {
        type: 'OBJECT',
        properties: {
          from:  { type: 'STRING', description: 'Start point' },
          to:    { type: 'STRING', description: 'End point' },
          color: { type: 'STRING', enum: BoardModel.WIRE_COLORS, description: 'Red for +, black for -.' },
        },
        required: ['from', 'to', 'color'],
      },
    },
    {
      name: 'remove_component',
      description: 'Remove one part by id, e.g. "led_1". Wires in its holes stay.',
      parameters: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING', description: 'Part id, e.g. "resistor_0"' } },
        required: ['id'],
      },
    },
    {
      name: 'remove_wire',
      description: 'Remove the wire between two points, named as they appear in the board state.',
      parameters: {
        type: 'OBJECT',
        properties: {
          from: { type: 'STRING', description: 'One end, e.g. "tp_3"' },
          to:   { type: 'STRING', description: 'The other end, e.g. "a3"' },
        },
        required: ['from', 'to'],
      },
    },
  ],
}];

// ── HTTP helpers ──────────────────────────────────────────────
// One /api/ask may take this long in all, repairs included.
const ASK_BUDGET_MS = 90000;
// A full board export is a few KB, so this is generous, and it stops a
// request from filling memory before it is even parsed.
const MAX_BODY_BYTES = 200 * 1024;

// The app calls /api/ask from its own origin, which needs no CORS at all.
// Beyond that only the app's other hosts and local development get a grant,
// never a wildcard.
const ALLOWED_ORIGINS = new Set([
  'https://sparky-na2c.onrender.com',
  'https://buildwithsparky.web.app',
  'https://sparkylab.web.app',
]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function setCORS(req, res) {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (!origin || !(ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin))) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

// Only framing is restricted. A full resource allowlist would have to track
// every CDN the pages load while they are being rewritten, and the Google
// sign-in popup cannot be exercised headless to prove one safe.
const DEFAULT_CSP = "frame-ancestors 'self'";

// Sent with every response, pages and API alike.
function setSecurityHeaders(res, csp) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (csp) res.setHeader('Content-Security-Policy', csp);
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Every /api/ask answer has the same shape, errors included.
const askReply = reply => ({ reply, actions: [], notes: [], verification: null });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error('request body too large'), { code: 'TOO_LARGE' });
    if (Number(req.headers['content-length']) > limit) return reject(tooLarge());
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { chunks.length = 0; reject(tooLarge()); }
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// /api/ask spends the Gemini key, so it is capped per client or it is an
// open proxy. Behind Render's proxy the socket address is the proxy's, which
// put every user in one bucket, so the client is the first X-Forwarded-For
// address. That header can be forged to dodge the per-client cap, so a cap
// on everyone together backs it up.
function makeRateLimiter({ windowMs = 60000, perClient = 20, total = 120 } = {}) {
  const hits = new Map();
  let all = [];
  return function limited(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const client = forwarded || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    if (hits.size > 5000) hits.clear();
    const mine = (hits.get(client) || []).filter(t => now - t < windowMs);
    mine.push(now);
    hits.set(client, mine);
    if (mine.length > perClient) return true;
    all = all.filter(t => now - t < windowMs);
    if (all.length >= total) return true;
    all.push(now);
    return false;
  };
}

// ── Static file serving ───────────────────────────────────────
const STATIC_ROOT = path.join(__dirname, '..');
// Doubles as the extension allowlist: anything not listed here is never served.
// .json is deliberately absent, every .json in this repo is build config.
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary', '.sparky': 'application/octet-stream',
};
// Server code, build sources and tooling. Mirrors the ignore list in firebase.json.
const DENY_DIRS = new Set(['backend', 'src', 'out', 'functions', 'node_modules']);

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    return sendJSON(res, 400, { error: 'Bad request path' });
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(STATIC_ROOT, urlPath);
  const rel = path.relative(STATIC_ROOT, filePath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return sendJSON(res, 403, { error: 'Forbidden' });
  }
  const segments = rel.split(path.sep);
  const ext = path.extname(filePath).toLowerCase();
  const servable = MIME[ext] &&
    !DENY_DIRS.has(segments[0].toLowerCase()) &&
    !segments.some(seg => seg.startsWith('.'));
  if (servable) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[ext] });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    } catch { /* file not found, fall through to 404 */ }
  }
  sendJSON(res, 404, { error: 'Not found' });
}

// ── The server ────────────────────────────────────────────────
// `generate` is the model from ai-providers.js, or null when none is
// configured. Tests pass a stub, and smaller rate limits.
function createServer({ generate = null, model = '', rateLimit, csp = DEFAULT_CSP } = {}) {
  const askRateLimited = makeRateLimiter(rateLimit);

  async function handleAsk(req, res) {
    if (askRateLimited(req)) {
      return sendJSON(res, 429, askReply('Too many requests. Give Sparky a moment and try again.'));
    }
    // A text/plain POST skips the CORS preflight, so any site could make a
    // visitor's browser spend the key. JSON forces the preflight.
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return sendJSON(res, 415, askReply('Send the request as JSON.'));
    }
    let raw;
    try {
      raw = await readBody(req, MAX_BODY_BYTES);
    } catch (e) {
      if (e.code !== 'TOO_LARGE') return sendJSON(res, 400, askReply('That request could not be read.'));
      // The rest of the body is not read, so the connection cannot be reused.
      res.setHeader('Connection', 'close');
      return sendJSON(res, 413, askReply('That request is too large.'));
    }
    let input;
    try {
      input = JSON.parse(raw || '{}');
    } catch {
      return sendJSON(res, 400, askReply('That request was not valid JSON.'));
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return sendJSON(res, 400, askReply('That request was not valid JSON.'));
    }
    if (!generate) {
      return sendJSON(res, 503, askReply('The AI tutor is not set up on this server yet.'));
    }

    const message = typeof input.message === 'string' ? input.message.slice(0, 4000) : '';
    try {
      const out = await answer({
        generate,
        message,
        history: input.history,
        board: input.board,
        markdown: typeof input.markdown === 'string' ? input.markdown.slice(0, 20000) : '',
        deadline: Date.now() + ASK_BUDGET_MS,
      });
      const v = out.verification;
      console.log(`[ask] "${message.slice(0, 60)}" -> ${out.actions.length} action(s)` +
                  (v ? `, ${v.attempts} attempt(s), ${v.ok ? 'works' : 'does not work'}` : ''));
      return sendJSON(res, 200, out);
    } catch (e) {
      if (e.code === 'BAD_BOARD') return sendJSON(res, 400, askReply(`That board could not be read: ${e.message}.`));
      // Upstream detail can include quota information, so it stays in the log.
      console.error('[ask] failed:', e.message);
      return sendJSON(res, 502, askReply('Sparky could not reach the AI service. Please try again in a moment.'));
    }
  }

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    setSecurityHeaders(res, csp);
    if (url.startsWith('/api/')) setCORS(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && url === '/api/health') {
      return sendJSON(res, 200, { status: 'ok', model });
    }
    if (req.method === 'POST' && url === '/api/ask') {
      handleAsk(req, res).catch(e => {
        console.error('[ask] crashed:', e && e.stack ? e.stack : e);
        if (!res.headersSent) sendJSON(res, 500, askReply('Something went wrong on the server.'));
      });
      return;
    }
    if (req.method === 'GET') return serveStatic(req, res);
    sendJSON(res, 404, { error: 'Not found' });
  });

  // Malformed HTTP from a client must not be fatal.
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    else socket.destroy();
  });
  return server;
}

function main() {
  loadEnv();
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  const needsKey = provider !== 'claude' && provider !== 'fixture';
  const apiKey = process.env.GEMINI_API_KEY;
  const model = needsKey ? (process.env.GEMINI_MODEL || 'gemini-flash-latest') : provider;
  const port = process.env.PORT || 5001;

  let generate = null;
  if (!needsKey || apiKey) {
    generate = makeProvider(provider, { apiKey, model, systemPrompt: SYSTEM_PROMPT, tools: CIRCUIT_TOOLS });
  } else {
    console.warn('Warning: GEMINI_API_KEY is not set, so /api/ask answers 503.');
  }

  // Last resort: log and keep serving rather than exiting on a single bad request.
  process.on('uncaughtException', err => {
    console.error('Uncaught exception:', err && err.stack ? err.stack : err);
  });
  process.on('unhandledRejection', err => {
    console.error('Unhandled rejection:', err && err.stack ? err.stack : err);
  });

  createServer({ generate, model }).listen(port, () => {
    console.log(`Sparky on http://localhost:${port}`);
    console.log(`   AI    : ${provider}`);
    console.log(`   Model : ${model}`);
    console.log(`   Health: http://localhost:${port}/api/health`);
  });
}

if (require.main === module) main();

module.exports = { createServer, SYSTEM_PROMPT, CIRCUIT_TOOLS, POWER_RECIPE, ledRecipe };
