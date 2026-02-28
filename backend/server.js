/**
 * Sparky AI Backend — Node.js (zero npm dependencies, CommonJS)
 * Requires Node 18+
 *
 * Run from backend/:  node server.js
 *
 * POST /api/ask   { markdown, message }  →  { reply, actions[] }
 * GET  /api/health
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

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
loadEnv();

const API_KEY    = process.env.WATSONX_APIKEY;
const PROJECT_ID = process.env.WATSONX_PROJECT_ID;
const WX_URL     = process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com';
const MODEL_ID   = 'meta-llama/llama-3-3-70b-instruct';
const PORT       = 5000;

if (!API_KEY || !PROJECT_ID) {
  console.error('❌  Missing WATSONX_APIKEY or WATSONX_PROJECT_ID in backend/.env');
  process.exit(1);
}

// ── IAM token cache ───────────────────────────────────────────
let _token = null, _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${API_KEY}`,
  });
  if (!res.ok) throw new Error(`IAM auth failed: ${res.status}`);
  const data = await res.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 120) * 1000;
  return _token;
}

// ── Prompts ───────────────────────────────────────────────────
const BASE_PROMPT =
`You are Sparky, a friendly AI electronics tutor. You help beginners build circuits on a virtual 830-point breadboard.

You will be shown the current board state as markdown tables, then a question. Answer based on what is actually on the board.

BREADBOARD RULES:
- Columns 1-29. Rows a/b/c/d/e = top half. Rows f/g/h/i/j = bottom half.
- Same column + same half = electrically connected (e.g. a14 and e14 share a node).
- The CENTER CHANNEL separates top from bottom — a14 and f14 are NOT connected unless you add a wire.
- tp_N = positive power rail at column N (+9V). tn_N = GND rail at column N.
- Rails are NOT auto-connected to body holes — always add a wire from tp/tn to the body hole.
- Battery pin0 = positive (+), pin1 = negative (−). Off-board; wire to the rails first.
- LED holeA = cathode (−) → GND. LED holeB = anode (+) → resistor → power.
- Every LED needs a resistor in series.

Reply style: 2-5 sentences max. Be specific with hole names like "a14" or "tp_10". Be encouraging.`;

// Tools addendum — stored as an array of strings joined to avoid backtick escaping issues
const TOOLS_ADDENDUM = [
  '',
  'You can modify the circuit by appending an actions JSON block at the very end of your reply.',
  'Output ONLY a valid JSON array inside the block — no comments, no trailing commas.',
  '',
  '=== SIZING RULES ===',
  'place_resistor : holeA and holeB exactly 4 columns apart, same row. E.g. a3 and a7.',
  'place_led      : holeA=cathode(−), holeB=anode(+), exactly 2 columns apart, same row. E.g. a9 and a7 (cathode a9, anode a7).',
  'place_button   : exactly 3 columns apart, same row. E.g. a12 and a15.',
  'place_buzzer   : exactly 2 columns apart, same row.',
  'Components on the same row MUST NOT share any columns — keep ranges non-overlapping.',
  '',
  '=== WIRING RECIPE FOR ONE LED (columns C to C+6) ===',
  'Power flows: tp_C -> resistor(holeA=a{C}, holeB=a{C+4}) -> LED anode(holeB=a{C+4}) -> LED cathode(holeA=a{C+6}) -> tn_{C+6}',
  'Note: resistor holeB and LED holeB share the same hole a{C+4} = they connect automatically.',
  'Wires needed: (1) tp_{C} to a{C}  (2) a{C+6} to tn_{C+6}',
  'For N LEDs in parallel, start each set 8 columns after the previous (C, C+8, C+16 ...).',
  '',
  '=== EXAMPLE: single LED at columns 3-9 ===',
  '```actions',
  '[',
  '  { "tool": "place_battery" },',
  '  { "tool": "add_wire", "from": "battery_0_pin0", "to": "tp_3",  "color": "red"   },',
  '  { "tool": "add_wire", "from": "battery_0_pin1", "to": "tn_9",  "color": "black" },',
  '  { "tool": "place_resistor", "holeA": "a3", "holeB": "a7" },',
  '  { "tool": "place_led",      "holeA": "a9", "holeB": "a7" },',
  '  { "tool": "add_wire", "from": "tp_3", "to": "a3",   "color": "red"   },',
  '  { "tool": "add_wire", "from": "a9",   "to": "tn_9", "color": "black" }',
  ']',
  '```',
  '',
  '=== EXAMPLE: three LEDs in parallel (starts at cols 3, 11, 19) ===',
  '```actions',
  '[',
  '  { "tool": "place_battery" },',
  '  { "tool": "add_wire", "from": "battery_0_pin0", "to": "tp_3",  "color": "red"   },',
  '  { "tool": "add_wire", "from": "battery_0_pin1", "to": "tn_9",  "color": "black" },',
  '  { "tool": "place_resistor", "holeA": "a3",  "holeB": "a7"  },',
  '  { "tool": "place_led",      "holeA": "a9",  "holeB": "a7"  },',
  '  { "tool": "add_wire", "from": "tp_3",  "to": "a3",   "color": "red"   },',
  '  { "tool": "add_wire", "from": "a9",    "to": "tn_9", "color": "black" },',
  '  { "tool": "place_resistor", "holeA": "a11", "holeB": "a15" },',
  '  { "tool": "place_led",      "holeA": "a17", "holeB": "a15" },',
  '  { "tool": "add_wire", "from": "tp_11", "to": "a11",  "color": "red"   },',
  '  { "tool": "add_wire", "from": "a17",   "to": "tn_17","color": "black" },',
  '  { "tool": "place_resistor", "holeA": "a19", "holeB": "a23" },',
  '  { "tool": "place_led",      "holeA": "a25", "holeB": "a23" },',
  '  { "tool": "add_wire", "from": "tp_19", "to": "a19",  "color": "red"   },',
  '  { "tool": "add_wire", "from": "a25",   "to": "tn_25","color": "black" }',
  ']',
  '```',
  '',
  '=== EXAMPLE: LED + push button (button in series on GND side) ===',
  '```actions',
  '[',
  '  { "tool": "place_battery" },',
  '  { "tool": "add_wire", "from": "battery_0_pin0", "to": "tp_3",  "color": "red"   },',
  '  { "tool": "add_wire", "from": "battery_0_pin1", "to": "tn_16", "color": "black" },',
  '  { "tool": "place_resistor", "holeA": "a3",  "holeB": "a7"  },',
  '  { "tool": "place_led",      "holeA": "a9",  "holeB": "a7"  },',
  '  { "tool": "place_button",   "holeA": "a12", "holeB": "a15" },',
  '  { "tool": "add_wire", "from": "tp_3",  "to": "a3",   "color": "red"    },',
  '  { "tool": "add_wire", "from": "a9",    "to": "a12",  "color": "yellow" },',
  '  { "tool": "add_wire", "from": "a15",   "to": "tn_15","color": "black"  }',
  ']',
  '```',
  '',
  '=== TOOLS ===',
  'place_battery',
  'place_resistor  holeA holeB   (4 cols apart, same row)',
  'place_led       holeA holeB   (holeA=cathode−, holeB=anode+, 2 cols apart, same row)',
  'place_buzzer    holeA holeB   (2 cols apart, same row)',
  'place_button    holeA holeB   (3 cols apart, same row)',
  'add_wire        from to color (red|yellow|green|blue|black|white)',
  'delete_all',
  '',
  '=== WIRE NAMES ===',
  'Body hole: "a3", "e14", "j22"',
  'Rail: "tp_5" (positive col 5), "tn_5" (GND col 5)',
  'Battery: "battery_0_pin0" (+), "battery_0_pin1" (−)  [use index from board state]',
  '',
  'Append an actions block whenever the user asks you to build, place, add, wire, fix, connect, create, or modify the circuit. Do NOT include it for pure analysis questions.',
].join('\n');

// ── Clean up model output ─────────────────────────────────────
function cleanReply(raw) {
  return raw
    .replace(/\n?QUESTION:\s*$/, '')
    .replace(/\n?BOARD STATE:\s*$/, '')
    .replace(/\n?Sparky:\s*$/, '')
    .trim();
}

// ── Parse ```actions or ```json block ─────────────────────────
function parseActions(text) {
  const match = text.match(/```(?:actions|json)\s*([\s\S]*?)```/);
  if (!match) return { reply: cleanReply(text), actions: [] };
  let actions = [];
  try { actions = JSON.parse(match[1].trim()); } catch (e) {
    console.warn('Could not parse actions JSON:', e.message);
  }
  return { reply: cleanReply(text.slice(0, match.index)), actions };
}

// ── Call watsonx ──────────────────────────────────────────────
async function askWatsonx(markdown, userMsg) {
  const token = await getToken();
  const msg   = userMsg || 'Analyze my circuit and tell me what to do next.';

  const prompt = `${BASE_PROMPT}\n${TOOLS_ADDENDUM}\n\nBOARD STATE:\n${markdown || '**Board status: EMPTY — no components or wires placed yet.**'}\n\nQUESTION: ${msg}\n\nANSWER:`;

  const res = await fetch(
    `${WX_URL}/ml/v1/text/generation?version=2023-05-29`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model_id: MODEL_ID,
        input: prompt,
        project_id: PROJECT_ID,
        parameters: {
          max_new_tokens: 1000,
          min_new_tokens: 10,
          temperature: 0.3,
          repetition_penalty: 1.1,
          stop_sequences: ['\nQUESTION:', '\nBOARD STATE:'],
        },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`watsonx ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.results?.[0]?.generated_text ?? '(no reply)';
}

// ── HTTP server ───────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJSON(res, status, obj) {
  setCORS(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/api/health') {
    return sendJSON(res, 200, { status: 'ok', model: MODEL_ID });
  }

  if (req.method === 'POST' && req.url === '/api/ask') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const { markdown = '', message = '' } = JSON.parse(body || '{}');
        const raw = await askWatsonx(markdown, message);
        const { reply, actions } = parseActions(raw);
        console.log(`[ask] "${message.slice(0,60)}" → ${actions.length} action(s)`);
        return sendJSON(res, 200, { reply, actions });
      } catch (e) {
        console.error('Error:', e.message);
        return sendJSON(res, 200, { reply: `⚠️ ${e.message}`, actions: [] });
      }
    });
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`⚡ Sparky AI  →  http://localhost:${PORT}`);
  console.log(`   Model : ${MODEL_ID}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
});
