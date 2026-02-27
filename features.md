# Sparky — Hackathon Feature Backlog

> Prioritized for 18-hour sprint (due 11:00 AM tomorrow)
> IBM Skills Build Hackathon — watsonx AI integration is MANDATORY

---

## PHASE 1 — Do First (Now → ~10 PM) — High energy

### [P1-A] Battery Component Visual Fix

- File: `circuit3d/js/components.js`
- Issue: Blue/white rectangular overlays obscure the +/− polarity symbols
- Fix: Simplify geometry on battery mesh, make terminal markings high-contrast
- Status: TODO

---

### [P1-B] Sparky AI — IBM watsonx Integration ⚠️ MANDATORY

This is the core hackathon requirement. Must be visibly working by ~10 PM.

#### Step 1 — Breadboard State Serializer

- File: `circuit3d/js/app.js` (or new `circuit3d/js/state-export.js`)
- Expose as `App.exportState()` on the window namespace
- Output a JSON snapshot of current board state:

```json
{
  "components": [
    { "type": "LED", "id": "led_0", "holes": ["e14", "e15"], "color": "red" },
    { "type": "RESISTOR", "id": "res_0", "holes": ["a14", "a18"], "value": "330Ω" }
  ],
  "wires": [
    { "from": "tp_14", "to": "a14" },
    { "from": "bn_15", "to": "e15" }
  ]
}
```

#### Step 2 — Python Flask Backend

- New file: `backend/app.py`
- Endpoint: `POST /api/ask`
- Request body: `{ "state": <boardJSON>, "message": <userMessage> }`
- Calls IBM watsonx `ibm-granite-13b-instruct-v2` (or `meta-llama/llama-3-70b-instruct`)
- System prompt instructs the model to act as a circuit tutor, give "next best step" guidance
- Returns: `{ "reply": "..." }`
- Dependencies: `flask`, `ibm_watsonx_ai`

#### Step 3 — Chat UI Panel

- Files: `circuit3d/index.html` + new `circuit3d/css/chat.css`
- Floating panel (bottom-right), collapsible
- Input field + send button
- Calls `POST /api/ask` with current `App.exportState()` + user message
- Renders AI reply in a scrollable message list
- "Analyze my circuit" button auto-sends state without a message

#### Step 4 — Prompt Engineering

- System prompt in `backend/app.py` should include:
  - Role: "You are Sparky, an electronics tutor helping beginners build circuits on a breadboard"
  - Context: injected board state JSON
  - Behavior: suggest next step, identify errors, explain component roles
  - Keep replies concise (2–4 sentences max for chat UX)

---

### [P1-C] New Components — Buzzer + Push Button

- File: `circuit3d/js/components.js`
- Buzzer: cylinder body, ~2×HS wide, 1.5×HS tall, dark gray, 2-hole footprint
- Push Button: square body, 4-hole footprint (DIP style), off-white cap
- Register in component palette in `circuit3d/js/app.js`
- Status: TODO

---

## PHASE 2 — Do Second (~10 PM → ~2 AM) — Moderate energy

### [P2-A] Save / Load Circuit

- Minimum viable: export/import JSON file (no backend required)
- `App.exportState()` → JSON.stringify → download as `.sparky` file
- Load: file input → JSON.parse → rebuild scene
- Stretch: persist to Supabase or localStorage
- Files: `circuit3d/js/app.js`, `circuit3d/index.html`

---

### [P2-B] Landing Page

- New file: `index.html` (project root)
- Sections: hero tagline, feature highlights, "Launch App" CTA, IBM watsonx badge
- Keep simple — one scrollable page, no frameworks
- Links to `circuit3d/index.html`

---

## PHASE 3 — If Time Allows (~2 AM → ~6 AM) — Low energy

### [P3-A] Dashboard Page

- New file: `dashboard.html`
- Shows list of saved circuits (from localStorage or Supabase)
- Simple cards: name, thumbnail (canvas screenshot), open/delete buttons
- Skip community gallery for now

### [P3-B] Puzzle / Remake Mode

- When loading a circuit, offer "Challenge Mode"
- Hides wires/components, user must reconstruct
- Hint: reveal one element at a time
- Full reveal button as fallback
- Complex — skip unless Phases 1+2 are fully done

### [P3-C] Transistor Component (Stretch)

- 3-pin DIP footprint (Base, Collector, Emitter)
- NPN symbol on face
- Skip unless time is comfortable

---

## PHASE 4 — Demo Prep (6 AM → 11 AM)

### [P4] 4-Minute Video Script

1. Open landing page — explain Sparky
2. Launch 3D circuit designer
3. Place LED + resistor + battery, wire them up
4. Open Sparky AI chat → ask "what's wrong with my circuit?" or "what should I do next?"
5. Show watsonx AI response in real time
6. Save circuit → show save/load flow
7. Close on IBM watsonx branding moment

**The money shot for judges: the AI analyzing the live board state.**

---

## Tech Stack Reference

- Frontend: Vanilla JS/HTML/CSS, Three.js r128, no build tools
- Backend: Python Flask + `ibm_watsonx_ai` SDK
- AI: IBM watsonx (granite or llama model)
- No frameworks, no npm, keep it simple

## File Structure (existing)

```text
circuit3d/
  index.html
  js/
    scene.js        ← Three.js scene setup
    breadboard.js   ← Grid, holes, board mesh
    components.js   ← Component meshes + placement
    interaction.js  ← Mouse events, drag, wire mode
    simulate.js     ← Circuit simulation logic
    app.js          ← Boot, state, mode management
  css/
backend/            ← TO BE CREATED for watsonx Flask API
index.html          ← TO BE CREATED landing page
```
