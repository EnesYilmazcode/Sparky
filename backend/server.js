/**
 * Sparky AI Backend — Node.js (zero npm dependencies, CommonJS)
 * Requires Node 18+
 *
 * Run from project root:  node backend/server.js
 * OR from backend folder: node server.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── Load .env manually ────────────────────────────────────────
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
  } catch { /* .env optional if env vars already set */ }
}
loadEnv();

const API_KEY    = process.env.WATSONX_APIKEY;
const PROJECT_ID = process.env.WATSONX_PROJECT_ID;
const WX_URL     = process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com';
const MODEL_ID   = 'ibm/granite-3-3-8b-instruct';
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

// ── Prompt & watsonx call ─────────────────────────────────────
const SYSTEM_PROMPT = `You are Sparky, a friendly electronics tutor helping beginners build circuits on a breadboard.
You receive a JSON snapshot of the user's breadboard (components + wires) and their question.

Rules:
- Spot errors: wrong polarity, missing resistors, unconnected components, short circuits.
- Suggest the single most important next step.
- Keep replies SHORT — 2 to 4 sentences. Be encouraging and clear.
- LED anode (+) connects to higher potential; cathode (-) to lower.
- Every LED needs a current-limiting resistor (220-470 ohm for 9V).
- Power rails: tp=positive top, tn=negative top, bp=positive bottom, bn=negative bottom.
- battery_pin0 = positive terminal, battery_pin1 = negative terminal.`;

async function askWatsonx(boardState, userMsg) {
  const token = await getToken();
  const prompt = `${SYSTEM_PROMPT}

--- BOARD STATE ---
${JSON.stringify(boardState, null, 2)}
-------------------

User: ${userMsg || 'Analyze my circuit and tell me what to do next.'}
Sparky:`;

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
          max_new_tokens: 220,
          min_new_tokens: 10,
          temperature: 0.7,
          repetition_penalty: 1.1,
          stop_sequences: ['\nUser:', '\n---'],
        },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`watsonx ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.results?.[0]?.generated_text?.trim() ?? '(no reply)';
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
        const { state = {}, message = '' } = JSON.parse(body || '{}');
        const reply = await askWatsonx(state, message);
        return sendJSON(res, 200, { reply });
      } catch (e) {
        console.error('Error:', e.message);
        return sendJSON(res, 200, { reply: `⚠️ ${e.message}` });
      }
    });
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`⚡ Sparky AI backend  →  http://localhost:${PORT}`);
  console.log(`   Model : ${MODEL_ID}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
});
