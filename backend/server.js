/**
 * Sparky AI Backend — Node.js (zero npm dependencies, CommonJS)
 * Requires Node 18+
 *
 * Run from backend/:  node server.js
 *
 * POST /api/ask            { markdown, message }  →  { reply, actions[] }
 * GET  /api/health
 * POST /api/auth/login     { email, password }    →  { access_token, ... }
 * POST /api/auth/signup    { email, password, name } → { access_token, ... }
 * GET  /api/auth/me                                →  { user }
 * GET  /api/circuits                               →  { circuits[] }
 * POST /api/circuits       { name, circuit }       →  { id, rev }
 * DELETE /api/circuits/:id                         →  { ok }
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
const PORT       = 5001;

// IBM App ID
const APPID_CLIENT_ID     = process.env.APPID_CLIENT_ID;
const APPID_CLIENT_SECRET = process.env.APPID_CLIENT_SECRET;
const APPID_OAUTH_URL     = process.env.APPID_OAUTH_URL; // e.g. https://us-south.appid.cloud.ibm.com/oauth/v4/<tenantId>

// IBM Cloudant
const CLOUDANT_URL    = process.env.CLOUDANT_URL;
const CLOUDANT_APIKEY = process.env.CLOUDANT_APIKEY;
const CLOUDANT_DB     = 'sparky_circuits';

if (!API_KEY || !PROJECT_ID) {
  console.error('Missing WATSONX_APIKEY or WATSONX_PROJECT_ID in backend/.env');
  process.exit(1);
}
if (!APPID_CLIENT_ID || !APPID_CLIENT_SECRET || !APPID_OAUTH_URL) {
  console.warn('Warning: APPID_CLIENT_ID / APPID_CLIENT_SECRET / APPID_OAUTH_URL not set — auth endpoints will fail');
}
if (!CLOUDANT_URL || !CLOUDANT_APIKEY) {
  console.warn('Warning: CLOUDANT_URL / CLOUDANT_APIKEY not set — circuit storage endpoints will fail');
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

// ── Cloudant IAM token cache ──────────────────────────────────
let _cloudantToken = null, _cloudantTokenExpiry = 0;

async function getCloudantToken() {
  if (_cloudantToken && Date.now() < _cloudantTokenExpiry) return _cloudantToken;
  const res = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${CLOUDANT_APIKEY}`,
  });
  if (!res.ok) throw new Error(`Cloudant IAM auth failed: ${res.status}`);
  const data = await res.json();
  _cloudantToken = data.access_token;
  _cloudantTokenExpiry = Date.now() + (data.expires_in - 120) * 1000;
  return _cloudantToken;
}

async function cloudantRequest(method, dbPath, body) {
  const token = await getCloudantToken();
  const url = `${CLOUDANT_URL}/${CLOUDANT_DB}${dbPath}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

async function ensureCloudantIndex() {
  try {
    await cloudantRequest('POST', '/_index', {
      index: { fields: ['userId', 'savedAt'] },
      name: 'user-circuits-idx',
      type: 'json',
    });
    console.log('   Cloudant index ready');
  } catch (e) {
    console.warn('   Cloudant index warning:', e.message);
  }
}

// ── App ID auth helper ───────────────────────────────────────
async function authenticateRequest(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const res = await fetch(`${APPID_OAUTH_URL}/userinfo`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const info = await res.json();
    return { sub: info.sub, email: info.email, name: info.name };
  } catch {
    return null;
  }
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

  // ── Auth: Google OAuth (redirect to App ID) ────────────────
  if (req.method === 'GET' && req.url === '/api/auth/google') {
    const redirectUri = `http://localhost:${PORT}/api/auth/callback`;
    const authUrl = `${APPID_OAUTH_URL}/authorization?client_id=${APPID_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid+email+profile&idp=google`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  // ── Auth: OAuth callback (exchange code for tokens) ────────
  if (req.method === 'GET' && req.url.startsWith('/api/auth/callback')) {
    try {
      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');

      if (error || !code) {
        const html = `<html><body><script>window.opener.postMessage({error:"${error || 'No code received'}"},"*");window.close();</script></body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      const redirectUri = `http://localhost:${PORT}/api/auth/callback`;
      const tokenRes = await fetch(`${APPID_OAUTH_URL}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${APPID_CLIENT_ID}:${APPID_CLIENT_SECRET}`).toString('base64'),
        },
        body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}`,
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error('Token exchange failed:', err);
        const html = `<html><body><script>window.opener.postMessage({error:"Login failed"},"*");window.close();</script></body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      const tokens = await tokenRes.json();
      console.log('[auth] Google login successful');
      const html = `<html><body><script>window.opener.postMessage({access_token:"${tokens.access_token}"},"*");window.close();</script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e) {
      console.error('Callback error:', e.message);
      const html = `<html><body><script>window.opener.postMessage({error:"${e.message}"},"*");window.close();</script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    }
    return;
  }

  // ── Auth: Me (validate token) ──────────────────────────────
  if (req.method === 'GET' && req.url === '/api/auth/me') {
    try {
      const user = await authenticateRequest(req);
      if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
      return sendJSON(res, 200, { user });
    } catch (e) {
      return sendJSON(res, 401, { error: 'Not authenticated' });
    }
  }

  // ── Circuits: List ─────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/circuits') {
    try {
      const user = await authenticateRequest(req);
      if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });

      const queryRes = await cloudantRequest('POST', '/_find', {
        selector: { userId: user.sub, type: 'circuit' },
        sort: [{ savedAt: 'desc' }],
        limit: 100,
      });
      const data = await queryRes.json();
      return sendJSON(res, 200, { circuits: data.docs || [] });
    } catch (e) {
      console.error('List circuits error:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // ── Circuits: Create ───────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/circuits') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const user = await authenticateRequest(req);
        if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });

        const { name, circuit } = JSON.parse(body || '{}');
        const doc = {
          type: 'circuit',
          userId: user.sub,
          name: name || 'Untitled Circuit',
          circuit,
          savedAt: Date.now(),
        };
        const saveRes = await cloudantRequest('POST', '', doc);
        const result = await saveRes.json();
        console.log(`[circuits] saved "${doc.name}" for ${user.email}`);
        return sendJSON(res, 201, { id: result.id, rev: result.rev });
      } catch (e) {
        console.error('Save circuit error:', e.message);
        return sendJSON(res, 500, { error: e.message });
      }
    });
    return;
  }

  // ── Circuits: Delete ───────────────────────────────────────
  const delMatch = req.url.match(/^\/api\/circuits\/([^/?]+)$/);
  if (req.method === 'DELETE' && delMatch) {
    try {
      const user = await authenticateRequest(req);
      if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });

      const docId = decodeURIComponent(delMatch[1]);
      const getRes = await cloudantRequest('GET', `/${docId}`, null);
      if (!getRes.ok) return sendJSON(res, 404, { error: 'Not found' });
      const existing = await getRes.json();
      if (existing.userId !== user.sub) return sendJSON(res, 403, { error: 'Forbidden' });

      await cloudantRequest('DELETE', `/${docId}?rev=${existing._rev}`, null);
      console.log(`[circuits] deleted "${existing.name}" for ${user.email}`);
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      console.error('Delete circuit error:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`⚡ Sparky AI  →  http://localhost:${PORT}`);
  console.log(`   Model : ${MODEL_ID}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  if (CLOUDANT_URL && CLOUDANT_APIKEY) ensureCloudantIndex();
});
