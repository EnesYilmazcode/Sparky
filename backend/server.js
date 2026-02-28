/**
 * Sparky AI Backend — Node.js (zero npm dependencies, CommonJS)
 * Requires Node 18+
 *
 * Run from project root:  node backend/server.js
 * Run from backend/:      node server.js
 *
 * POST /api/ask   { markdown, message, tools_enabled }  →  { reply, actions[] }
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
const BASE_PROMPT = `You are Sparky, a friendly AI electronics tutor. You help beginners build circuits on a virtual 830-point breadboard.

You will be shown the current board state as markdown tables, then a question. Answer the question based on what is actually on the board.

IMPORTANT breadboard rules:
- Columns 1-29. In each column: holes a/b/c/d/e share one electrical node (top section); holes f/g/h/i/j share another node (bottom section).
- The center channel physically separates top (a-e) from bottom (f-j). You MUST add a wire to connect across it.
- tp = positive power rail (+9V). tn = negative power rail / GND. These run the full board length.
- Rails are NOT automatically connected to body holes — you must add a wire from tp/tn to the body hole.
- LED pin_A = cathode (−) → to GND. LED pin_B = anode (+) → to higher voltage through a resistor.
- Every LED needs a 220-470 ohm resistor in series or it will burn out instantly at 9V.
- Battery pin0 = positive (+). Battery pin1 = negative (−). They are off-board; connect via the wire ref shown in the board state.

Reply style: 2-5 sentences max. Be specific with hole names like "a14" or "tp_10". Be encouraging.`;

const TOOLS_ADDENDUM = `

You can modify the circuit by appending an actions JSON block at the very end of your reply.
Format EXACTLY like this — valid JSON array, nothing else inside the block:

\`\`\`actions
[
  { "tool": "place_battery" },
  { "tool": "place_resistor", "holeA": "a16", "holeB": "a20" },
  { "tool": "place_led",      "holeA": "e14", "holeB": "e16" },
  { "tool": "add_wire", "from": "battery_0_pin0", "to": "tp_20", "color": "red" },
  { "tool": "add_wire", "from": "battery_0_pin1", "to": "tn_14", "color": "black" },
  { "tool": "add_wire", "from": "tp_20", "to": "a20",  "color": "red" },
  { "tool": "add_wire", "from": "e16",   "to": "a16",  "color": "yellow" },
  { "tool": "add_wire", "from": "e14",   "to": "tn_14","color": "black" }
]
\`\`\`

Available tools:
- place_battery                          (always place before wiring to it)
- place_resistor  "holeA"  "holeB"       (holeA and holeB must be 4 columns apart in same row, e.g. a16 and a20)
- place_led       "holeA"  "holeB"       (holeA=cathode(−), holeB=anode(+), 2 columns apart, e.g. e14 and e16)
- place_buzzer    "holeA"  "holeB"       (2 columns apart)
- place_button    "holeA"  "holeB"       (3 columns apart)
- add_wire        "from"   "to"  "color" (color: "red"|"yellow"|"green"|"blue"|"black"|"white")
- delete_all

WIRE NAMING:
- Breadboard hole: "e14", "a10", "tp_10", "tn_5" etc.
- Battery terminal: "battery_0_pin0" (positive), "battery_0_pin1" (negative)
  (replace 0 with the battery index shown in the board state)

Only append the actions block if the user is asking you to build or fix something. Do NOT include it for analysis-only questions.`;

// ── Clean up model output ─────────────────────────────────────
function cleanReply(raw) {
  // Strip common role-play artifacts the model sometimes appends
  return raw
    .replace(/\n?QUESTION:\s*$/, '')
    .replace(/\n?BOARD STATE:\s*$/, '')
    .replace(/\n?Sparky:\s*$/, '')
    .trim();
}

// ── Parse ```actions block ────────────────────────────────────
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
async function askWatsonx(markdown, userMsg, toolsEnabled) {
  const token  = await getToken();
  const system = toolsEnabled ? BASE_PROMPT + TOOLS_ADDENDUM : BASE_PROMPT;
  const msg    = userMsg || 'Analyze my circuit and tell me what to do next.';

  // Use QUESTION/ANSWER format — avoids collision with stop sequences
  const prompt = `${system}

BOARD STATE:
${markdown || '**Board status: EMPTY — no components or wires placed yet.**'}

QUESTION: ${msg}

ANSWER:`;

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
          max_new_tokens: 800,
          min_new_tokens: 10,
          temperature: 0.4,
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
        const { markdown = '', message = '', tools_enabled = false } = JSON.parse(body || '{}');
        const raw = await askWatsonx(markdown, message, tools_enabled);
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
