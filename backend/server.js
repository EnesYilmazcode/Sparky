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

// ── Gemini system prompt ─────────────────────────────────────
const SYSTEM_PROMPT = [
  'You are Sparky, a friendly AI electronics tutor. You help beginners build circuits on a virtual 700-point breadboard.',
  '',
  'BREADBOARD LAYOUT:',
  '- Columns 1-50. Rows a/b/c/d/e = top half. Rows f/g/h/i/j = bottom half.',
  '- Same column + same half = electrically connected (e.g. a14 and e14 share a node).',
  '- The CENTER CHANNEL separates top from bottom. a14 and f14 are NOT connected unless you wire them.',
  '- tp_N = positive power rail at column N (+9V). tn_N = GND rail at column N.',
  '- Rails are NOT auto-connected to body holes. Always wire from tp/tn to body holes.',
  '',
  'BATTERY (CRITICAL):',
  '- pin0 = positive (+), pin1 = negative (-). The battery sits off-board.',
  '- EVERY circuit needs a battery with TWO wires:',
  '  1. add_wire from "battery_0_pin0" to "tp_N" (red wire)',
  '  2. add_wire from "battery_0_pin1" to "tn_N" (black wire)',
  '- Without BOTH battery wires the circuit WILL NOT WORK. ALWAYS include them.',
  '',
  'COMPONENT RULES:',
  '- LED: holeA = cathode (-) goes toward GND. holeB = anode (+) goes toward resistor/power.',
  '- Every LED needs a resistor in series to limit current.',
  '',
  'SIZING (columns apart, same row):',
  '- place_resistor: exactly 4 columns apart (e.g. a3 and a7)',
  '- place_led: exactly 2 columns apart (e.g. cathode a9, anode a7)',
  '- place_button: exactly 3 columns apart (e.g. a12 and a15)',
  '- place_buzzer: exactly 2 columns apart',
  '- No column overlap between components on the same row.',
  '',
  'HOLE NAMES:',
  '- Body: "a3", "e14", "j22"',
  '- Rail: "tp_5" (positive col 5), "tn_5" (GND col 5)',
  '- Battery: "battery_0_pin0" (+), "battery_0_pin1" (-)',
  '',
  'BUILDING BEHAVIOR:',
  '- When asked to build, fix, or create a circuit: call delete_all FIRST, then rebuild from scratch.',
  '- Never patch an existing circuit. Always clear and rebuild the full correct circuit.',
  '- After building, write 2-3 sentences explaining what you built and how it works.',
  '',
  'CRITICAL WIRING RULES:',
  '- Placing a component on the board does NOT connect it to power or ground.',
  '- You MUST add_wire from a power rail (tp_N) to each component that needs +9V.',
  '- You MUST add_wire from each component that needs GND to a ground rail (tn_N).',
  '- Without these rail-to-body wires, the circuit WILL NOT WORK.',
  '',
  'COMPLETE RECIPE FOR ONE LED (starting at column C):',
  '  1. delete_all',
  '  2. place_battery',
  '  3. add_wire: battery_0_pin0 -> tp_C (red)       ← battery to + rail',
  '  4. add_wire: battery_0_pin1 -> tn_{C+6} (black) ← battery to - rail',
  '  5. place_resistor: holeA=a{C}, holeB=a{C+4}',
  '  6. place_led: holeA=a{C+6} (cathode), holeB=a{C+4} (anode)',
  '  7. add_wire: tp_{C} -> a{C} (red)               ← rail to resistor (REQUIRED!)',
  '  8. add_wire: a{C+6} -> tn_{C+6} (black)         ← LED cathode to rail (REQUIRED!)',
  'Steps 7 and 8 are REQUIRED for EVERY LED group. Without them the LED will not light up.',
  '',
  'FOR 3 LEDs (at C=2, C=10, C=18):',
  '  Total calls: 1 delete_all + 1 place_battery + 2 battery wires + 3*(place_resistor + place_led + 2 rail wires) = 16 calls.',
  '  Every LED group needs its own pair of rail-to-body wires: tp_{C}->a{C} and a{C+6}->tn_{C+6}.',
  '',
  'Reply style: 2-5 sentences max. Be specific with hole names. Be encouraging.',
  'For pure questions (no building), just respond with helpful text. Do not call any tools.',
].join('\n');

// ── Gemini function declarations ─────────────────────────────
const CIRCUIT_TOOLS = [{
  function_declarations: [
    {
      name: 'delete_all',
      description: 'Clear all components and wires from the board. Call this FIRST when building or fixing a circuit.',
    },
    {
      name: 'place_battery',
      description: 'Place a 9V battery off-board. You MUST follow this with add_wire calls to connect battery_0_pin0 to a positive rail (tp_N) and battery_0_pin1 to a negative rail (tn_N).',
    },
    {
      name: 'place_resistor',
      description: 'Place a resistor. holeA and holeB must be exactly 4 columns apart on the same row.',
      parameters: {
        type: 'OBJECT',
        properties: {
          holeA: { type: 'STRING', description: 'Start hole, e.g. "a3"' },
          holeB: { type: 'STRING', description: 'End hole, 4 columns from holeA, e.g. "a7"' },
        },
        required: ['holeA', 'holeB'],
      },
    },
    {
      name: 'place_led',
      description: 'Place an LED. holeA = cathode (-), holeB = anode (+). Must be exactly 2 columns apart on the same row.',
      parameters: {
        type: 'OBJECT',
        properties: {
          holeA: { type: 'STRING', description: 'Cathode (-) hole, e.g. "a9"' },
          holeB: { type: 'STRING', description: 'Anode (+) hole, e.g. "a7"' },
        },
        required: ['holeA', 'holeB'],
      },
    },
    {
      name: 'place_buzzer',
      description: 'Place a buzzer. holeA and holeB must be exactly 2 columns apart on the same row.',
      parameters: {
        type: 'OBJECT',
        properties: {
          holeA: { type: 'STRING', description: 'First hole, e.g. "a3"' },
          holeB: { type: 'STRING', description: 'Second hole, e.g. "a5"' },
        },
        required: ['holeA', 'holeB'],
      },
    },
    {
      name: 'place_button',
      description: 'Place a push button. holeA and holeB must be exactly 3 columns apart on the same row.',
      parameters: {
        type: 'OBJECT',
        properties: {
          holeA: { type: 'STRING', description: 'First hole, e.g. "a12"' },
          holeB: { type: 'STRING', description: 'Second hole, e.g. "a15"' },
        },
        required: ['holeA', 'holeB'],
      },
    },
    {
      name: 'add_wire',
      description: 'Add a wire between two points. Points can be body holes (e.g. "a3"), rails (e.g. "tp_5", "tn_5"), or battery pins (e.g. "battery_0_pin0").',
      parameters: {
        type: 'OBJECT',
        properties: {
          from:  { type: 'STRING', description: 'Start point' },
          to:    { type: 'STRING', description: 'End point' },
          color: { type: 'STRING', description: 'Wire color: red, yellow, green, blue, black, or white' },
        },
        required: ['from', 'to', 'color'],
      },
    },
  ],
}];

// ── HTTP helpers ──────────────────────────────────────────────
// One /api/ask may take this long in all, repairs included.
const ASK_BUDGET_MS = 90000;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJSON(res, status, obj) {
  setCORS(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Every /api/ask answer has the same shape, errors included.
const askReply = reply => ({ reply, actions: [], notes: [], verification: null });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// /api/ask spends the Gemini key, so cap it per IP or it is an open proxy.
function makeRateLimiter({ windowMs = 60000, max = 20 } = {}) {
  const hits = new Map();
  return function limited(req) {
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    if (hits.size > 5000) hits.clear();
    const mine = (hits.get(ip) || []).filter(t => now - t < windowMs);
    mine.push(now);
    hits.set(ip, mine);
    return mine.length > max;
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
// configured. Tests pass a stub.
function createServer({ generate = null, model = '' } = {}) {
  const askRateLimited = makeRateLimiter();

  async function handleAsk(req, res) {
    if (askRateLimited(req)) {
      return sendJSON(res, 429, askReply('Too many requests. Give Sparky a moment and try again.'));
    }
    let input;
    try {
      input = JSON.parse((await readBody(req)) || '{}');
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
    setCORS(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = req.url.split('?')[0];

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

module.exports = { createServer, SYSTEM_PROMPT, CIRCUIT_TOOLS };
