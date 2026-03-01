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

const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const PORT         = process.env.PORT || 5001;

// IBM App ID
const APPID_CLIENT_ID     = process.env.APPID_CLIENT_ID;
const APPID_CLIENT_SECRET = process.env.APPID_CLIENT_SECRET;
const APPID_OAUTH_URL     = process.env.APPID_OAUTH_URL; // e.g. https://us-south.appid.cloud.ibm.com/oauth/v4/<tenantId>

// IBM Cloudant
const CLOUDANT_URL    = process.env.CLOUDANT_URL;
const CLOUDANT_APIKEY = process.env.CLOUDANT_APIKEY;
const CLOUDANT_DB     = 'sparky_circuits';

if (!GEMINI_KEY) {
  console.warn('Warning: GEMINI_API_KEY not set — /api/ask will fail');
}
if (!APPID_CLIENT_ID || !APPID_CLIENT_SECRET || !APPID_OAUTH_URL) {
  console.warn('Warning: APPID_CLIENT_ID / APPID_CLIENT_SECRET / APPID_OAUTH_URL not set — auth endpoints will fail');
}
if (!CLOUDANT_URL || !CLOUDANT_APIKEY) {
  console.warn('Warning: CLOUDANT_URL / CLOUDANT_APIKEY not set — circuit storage endpoints will fail');
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

// ── Gemini system prompt ─────────────────────────────────────
const SYSTEM_PROMPT = [
  'You are Sparky, a friendly AI electronics tutor. You help beginners build circuits on a virtual 830-point breadboard.',
  '',
  'BREADBOARD LAYOUT:',
  '- Columns 1-29. Rows a/b/c/d/e = top half. Rows f/g/h/i/j = bottom half.',
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

// ── Validate actions — auto-inject missing wires ─────────────
function validateActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return actions;

  const result = [...actions];

  // === Pass 1: Battery wire injection ===
  let batIdx = 0;
  let offset = 0;
  for (let i = 0; i < actions.length; i++) {
    if (actions[i].tool !== 'place_battery') continue;

    const pin0 = `battery_${batIdx}_pin0`;
    const pin1 = `battery_${batIdx}_pin1`;
    const hasPos = result.some(a => a.tool === 'add_wire' && (a.from === pin0 || a.to === pin0));
    const hasNeg = result.some(a => a.tool === 'add_wire' && (a.from === pin1 || a.to === pin1));

    if (!hasPos || !hasNeg) {
      // Infer rail columns from first resistor / LED
      let tpCol = null, tnCol = null;
      for (const a of result) {
        if (a.tool !== 'add_wire') continue;
        const tp = (a.from || '').match(/^tp_(\d+)$/) || (a.to || '').match(/^tp_(\d+)$/);
        const tn = (a.from || '').match(/^tn_(\d+)$/) || (a.to || '').match(/^tn_(\d+)$/);
        if (tp && !tpCol) tpCol = parseInt(tp[1]);
        if (tn && !tnCol) tnCol = parseInt(tn[1]);
      }
      if (!tpCol) {
        const r = actions.find(a => a.tool === 'place_resistor');
        tpCol = r ? parseInt((r.holeA || '').match(/\d+/)?.[0]) || 3 : 3;
      }
      if (!tnCol) {
        const l = actions.find(a => a.tool === 'place_led');
        tnCol = l ? parseInt((l.holeA || '').match(/\d+/)?.[0]) || 9 : 9;
      }

      const inject = [];
      if (!hasPos) inject.push({ tool: 'add_wire', from: pin0, to: `tp_${tpCol}`, color: 'red' });
      if (!hasNeg) inject.push({ tool: 'add_wire', from: pin1, to: `tn_${tnCol}`, color: 'black' });
      result.splice(i + 1 + offset, 0, ...inject);
      offset += inject.length;
      console.log(`[validate] Injected ${inject.length} battery_${batIdx} wire(s)`);
    }
    batIdx++;
  }

  // === Pass 2: Rail-to-body wires for resistor+LED pairs ===
  // Build a set of all holes that already have a wire touching them
  const wiredHoles = new Set();
  for (const a of result) {
    if (a.tool !== 'add_wire') continue;
    if (a.from) wiredHoles.add(a.from);
    if (a.to)   wiredHoles.add(a.to);
  }

  const resistors = result.filter(a => a.tool === 'place_resistor');
  const leds      = result.filter(a => a.tool === 'place_led');

  for (const res of resistors) {
    // Find an LED that shares a hole with this resistor
    const led = leds.find(l =>
      l.holeA === res.holeA || l.holeA === res.holeB ||
      l.holeB === res.holeA || l.holeB === res.holeB
    );
    if (!led) continue;

    // Resistor outer hole = the hole NOT shared with the LED → power side
    const resSharedB = (res.holeB === led.holeA || res.holeB === led.holeB);
    const resOuter = resSharedB ? res.holeA : res.holeB;

    // LED outer hole = the hole NOT shared with the resistor → ground side
    const ledSharedB = (led.holeB === res.holeA || led.holeB === res.holeB);
    const ledOuter = ledSharedB ? led.holeA : led.holeB;

    // Inject power wire: tp_N → resistor outer hole
    const resCol = resOuter.match(/(\d+)/)?.[1];
    if (resCol && !wiredHoles.has(resOuter)) {
      result.push({ tool: 'add_wire', from: `tp_${resCol}`, to: resOuter, color: 'red' });
      wiredHoles.add(resOuter);
      console.log(`[validate] Injected power wire: tp_${resCol} → ${resOuter}`);
    }

    // Inject ground wire: LED outer hole → tn_N
    const ledCol = ledOuter.match(/(\d+)/)?.[1];
    if (ledCol && !wiredHoles.has(ledOuter)) {
      result.push({ tool: 'add_wire', from: ledOuter, to: `tn_${ledCol}`, color: 'black' });
      wiredHoles.add(ledOuter);
      console.log(`[validate] Injected ground wire: ${ledOuter} → tn_${ledCol}`);
    }
  }

  return result;
}

// ── Call Gemini ──────────────────────────────────────────────
async function askGemini(markdown, userMsg) {
  const msg = userMsg || 'Analyze my circuit and tell me what to do next.';
  const boardState = markdown || '**Board is EMPTY — no components or wires placed.**';

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [{ text: `BOARD STATE:\n${boardState}\n\nQUESTION: ${msg}` }],
    }],
    tools: CIRCUIT_TOOLS,
    tool_config: { function_calling_config: { mode: 'AUTO' } },
    generation_config: { temperature: 0.3, max_output_tokens: 2048 },
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];

  // Handle blocked / empty responses
  if (!candidate || candidate.finishReason === 'SAFETY') {
    return { reply: "I can't help with that request. Try asking about building a circuit!", actions: [] };
  }

  const parts = candidate.content?.parts || [];
  let reply = '';
  let actions = [];

  for (const part of parts) {
    if (part.text) reply += part.text;
    if (part.functionCall) {
      const fc = part.functionCall;
      actions.push({ tool: fc.name, ...(fc.args || {}) });
    }
  }

  reply = reply.trim();

  // If model returned only function calls with no text, provide a default
  if (!reply && actions.length > 0) {
    reply = "Here you go! I've built the circuit for you. Hit Run Simulation to test it out!";
  } else if (!reply) {
    reply = '(no response)';
  }

  // Fallback: also check text for JSON actions block (in case model embeds JSON in text)
  if (actions.length === 0) {
    const match = reply.match(/```(?:actions|json)\s*([\s\S]*?)```/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (Array.isArray(parsed)) actions = parsed;
        reply = reply.slice(0, match.index).trim();
      } catch { /* ignore parse errors */ }
    }
  }

  // Filter out malformed actions (missing required fields)
  actions = actions.filter(a => {
    if (a.tool === 'add_wire' && (!a.from || !a.to)) return false;
    if (['place_resistor','place_led','place_buzzer','place_button'].includes(a.tool)
        && (!a.holeA || !a.holeB)) return false;
    return true;
  });

  actions = validateActions(actions);
  return { reply, actions };
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
    return sendJSON(res, 200, { status: 'ok', model: GEMINI_MODEL });
  }

  if (req.method === 'POST' && req.url === '/api/ask') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const { markdown = '', message = '' } = JSON.parse(body || '{}');
        const { reply, actions } = await askGemini(markdown, message);
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
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['host'] || `localhost:${PORT}`;
    const redirectUri = `${proto}://${host}/api/auth/callback`;
    const authUrl = `${APPID_OAUTH_URL}/authorization?client_id=${APPID_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid+email+profile&idp=google`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  // ── Auth: OAuth callback (exchange code for tokens) ────────
  if (req.method === 'GET' && req.url.startsWith('/api/auth/callback')) {
    try {
      const cbProto = req.headers['x-forwarded-proto'] || 'http';
      const cbHost = req.headers['host'] || `localhost:${PORT}`;
      const urlObj = new URL(req.url, `${cbProto}://${cbHost}`);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');

      if (error || !code) {
        const html = `<html><body><script>window.opener.postMessage({error:"${error || 'No code received'}"},"*");window.close();</script></body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      const redirectUri = `${cbProto}://${cbHost}/api/auth/callback`;
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

  // ── Static file serving ───────────────────────────────────
  const STATIC_ROOT = path.join(__dirname, '..');
  const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.glb': 'model/gltf-binary', '.sparky': 'application/octet-stream',
  };

  if (req.method === 'GET') {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(STATIC_ROOT, urlPath);
    if (!filePath.startsWith(STATIC_ROOT)) return sendJSON(res, 403, { error: 'Forbidden' });
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    } catch { /* file not found — fall through to 404 */ }
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`⚡ Sparky AI  →  http://localhost:${PORT}`);
  console.log(`   Model : ${GEMINI_MODEL}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  if (CLOUDANT_URL && CLOUDANT_APIKEY) ensureCloudantIndex();
});
