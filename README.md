# ⚡ Sparky — 3D Circuit Designer with IBM watsonx AI

Sparky is a browser-based 3D breadboard circuit designer with an embedded AI tutor powered by IBM watsonx. It lets electronics beginners place components, draw wires, run circuit simulations, and get real-time AI guidance — all in a single web page with no installation required.

![Sparky Circuit Designer](demo.png)

Built for the **IBM Skills Build Hackathon**.

---

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
  - [The 3D Breadboard](#the-3d-breadboard)
  - [Component System](#component-system)
  - [Interaction & Modes](#interaction--modes)
  - [Circuit Simulation](#circuit-simulation)
  - [AI Tutor — IBM watsonx](#ai-tutor--ibm-watsonx)
  - [Save & Load](#save--load)
- [Getting Started](#getting-started)
- [Tech Stack](#tech-stack)
- [Architecture Deep Dive](#architecture-deep-dive)

---

## Features

| Feature | Description |
|---|---|
| **3D Breadboard** | Fully procedural 830-point breadboard rendered in Three.js |
| **5 Components** | Resistor, LED, Battery (9V), Buzzer, Push Button |
| **Wire Drawing** | Click any hole or pin to start a wire; pick from 6 colors |
| **Circuit Simulation** | Finds all parallel paths, calculates current, lights up LEDs |
| **Interactive Button** | Click a placed button during simulation to open/close the circuit live |
| **AI Tutor** | Sparky AI reads the board state and can build or fix your circuit |
| **AI Tool Calls** | The AI places components and wires directly onto the 3D board |
| **Save / Load** | Export and import circuits as `.sparky` JSON files |
| **Ghost Preview** | Transparent preview of components before placing |
| **Keyboard Shortcuts** | Full keyboard control for modes, rotation, and deletion |

---

## Project Structure

```
Sparky/
├── index.html                  # Landing page
├── features.md                 # Feature backlog / roadmap
│
├── circuit3d/                  # Main application
│   ├── index.html              # App shell (Three.js canvas + UI)
│   ├── css/
│   │   ├── style.css           # Light UI theme (topbar, sidebar, statusbar)
│   │   └── chat.css            # Dark IBM-themed AI chat panel
│   └── js/
│       ├── scene.js            # Three.js scene, renderer, camera, lights
│       ├── breadboard.js       # Procedural breadboard geometry + hole grid
│       ├── components.js       # 3D models for all component types
│       ├── interaction.js      # Mouse events, raycasting, ghost preview, wires
│       ├── simulate.js         # Circuit simulation engine
│       └── app.js              # State machine, placement, render loop
│
└── backend/
    ├── server.js               # Node.js HTTP server → IBM watsonx REST API
    └── .env                    # IBM watsonx credentials (not committed to git)
```

### Script Load Order

Scripts must load in this exact order (defined in `circuit3d/index.html`):

```
scene.js → breadboard.js → components.js → interaction.js → simulate.js → app.js
```

Each file extends the shared `window.App` namespace using the IIFE pattern:

```js
(function (App) {
  // add functions and state to App
})(window.App = window.App || {});
```

Boot is **async**: `app.js` calls `App.createBreadboard().then(bb => { ... })` and only initialises interaction after the breadboard Promise resolves, ensuring all mode functions exist before event handlers wrap them.

---

## How It Works

### The 3D Breadboard

The breadboard is fully procedural — no external 3D model files. Everything is built in `breadboard.js` using Three.js geometry primitives and a Canvas-generated texture.

#### Grid Layout

```
Columns: 1–29  (29 total, 0-indexed internally)
Hole spacing (HS): 0.625 world units

Row layout along the Z axis:

  tp  ──── positive power rail (+9V)  ← near side (viewer)
  tn  ──── negative rail (GND)

  a  ─┐
  b   │  Top half  (rows a-e)
  c   │  Holes in same column share one electrical node
  d   │
  e  ─┘

  ══ CENTER CHANNEL ══  (physical gap — no electrical connection)

  f  ─┐
  g   │  Bottom half  (rows f-j)
  h   │  Holes in same column share one electrical node
  i   │
  j  ─┘

  bn  ──── bottom negative rail (GND)
  bp  ──── bottom positive rail (+9V)  ← far side
```

#### Electrical Connectivity Rules

- **Same column, same half → connected.** `a14` and `e14` share a node; so do `f14` and `j14`.
- **Across the center channel → NOT connected.** `e14` and `f14` are isolated unless you add an explicit wire.
- **Power rails** → `tp_N` is the positive rail at column N. All columns on the same rail are connected. Rails are NOT auto-connected to body holes — you must wire them (e.g. `tp_5 → a5`).
- **Battery terminals** → `battery_0_pin0` = positive, `battery_0_pin1` = negative. Always wire to the rails first.

#### Visual Construction

The board is built from these layers:

1. `BoxGeometry` — cream-coloured board body
2. `PlaneGeometry` with a `CanvasTexture` — top surface drawn via the HTML5 Canvas API, including row letters, column numbers, rail colour bands, +/− symbols, and the DIP channel
3. `InstancedMesh` (580 `CylinderGeometry` instances) — the holes, used as the raycast target in wire mode
4. An invisible `PlaneGeometry` named `bb-body` — raycast plane for place mode

#### Breadboard API

`App.createBreadboard()` returns a Promise that resolves with:

```js
{
  group,             // THREE.Group — add to scene
  holesMesh,         // InstancedMesh for wire-mode raycasting
  holeData,          // Array of { col, row, x, z, world, occupied }
  getNearestHole(wx, wz),        // Snap to nearest hole within threshold
  getHole(col, row),             // Get a specific hole by address
  getSpanHole(start, span, rot), // Get second hole for a component
  COLS, HS, ROW_Z, BOARD_W, BOARD_D
}
```

---

### Component System

All components are built in `components.js` from Three.js primitives — no `.glb` files required. Each builder returns `{ group, pins, [capMesh] }`.

#### Component Types

| Component | Column Span | Pin 0 | Pin 1 | Notes |
|---|---|---|---|---|
| **Resistor** | 4 | holeA | holeB | Axial leads, colour band body |
| **LED** | 2 | holeA = cathode (−) | holeB = anode (+) | Glows during simulation |
| **Battery** | Off-board | Positive (+) | Negative (−) | Fixed off-board position |
| **Buzzer** | 2 | holeA | holeB | Cylindrical black body |
| **Push Button** | 3 | holeA | holeB | Normally-open momentary switch |

#### Ghost Preview

In **Place** mode, a transparent ghost of the selected component tracks the cursor. Ghost meshes use `depthWrite: false` and 42% opacity. The ghost is rebuilt whenever the component type or rotation changes.

#### Pin Markers

After placing any component, small gold sphere meshes are added at each pin position. These are:
- The raycast targets for starting a wire from a component pin
- They glow on hover in wire mode to indicate they're clickable

---

### Interaction & Modes

The app has three modes, set via `App.setMode(mode)`:

| Mode | Key | What It Does |
|---|---|---|
| **Select** | `S` | Click a component or wire to select it. `Delete` / `Backspace` removes it. |
| **Place** | `P` | Hover to preview. Click to place. `R` rotates 90°. `Esc` cancels. |
| **Wire** | `W` | Click any hole or gold pin to start a wire. Click again to finish. `Esc` cancels. |

Clicking a component in the sidebar activates Place mode with that type selected.

#### Keyboard Shortcuts

| Key | Action |
|---|---|
| `S` | Select mode |
| `P` | Place mode |
| `W` | Wire mode |
| `R` | Rotate placement 90° |
| `Esc` | Cancel / return to Select |
| `Delete` / `Backspace` | Delete selected item |

#### Raycasting

`interaction.js` maintains a `THREE.Raycaster` updated every `mousemove`. Targets differ by mode:

- **Place** — casts against the invisible `bb-body` plane, snaps result to nearest hole
- **Wire** — casts against the `holesMesh` InstancedMesh and all pin spheres
- **Select** — casts against all component meshes and all wire tube meshes

#### Drag Detection

`mousedown` position is stored and compared on `mousemove`. If the cursor moves more than 7 px, the event is treated as a camera orbit drag and the `click` event is suppressed — this prevents accidental component placement while rotating the view.

#### Wire Drawing

1. First click stores `state.wireStart = { world, holeRef, pinMesh }`
2. While `wireStart` is active, a dashed `LineDashedMaterial` preview line follows the cursor
3. Second click calls `App.finishWire(end)`, which creates the wire object and adds it to `state.wires`

Each wire record stores `startHole`, `endHole`, `startComp`, `startPinIdx`, `endComp`, `endPinIdx` for use by the simulation engine.

---

### Circuit Simulation

`simulate.js` models the circuit as a graph and uses a Union-Find structure to determine electrical connectivity.

#### Step 1: Build the Graph (Union-Find)

Every hole maps to a node ID:

```js
bbNodeId(col, row):
  row a-e → "bb_top_{col}"    // top half — column-shared
  row f-j → "bb_bot_{col}"    // bottom half — column-shared
  row tp/tn/bp/bn → "bb_rail_{row}"   // full-length rail
```

Building the graph:
1. Assign each component pin to its node
2. Each wire unions its two endpoint nodes
3. **Closed buttons** union their two pin nodes (closed switch = short circuit between them)
4. **Open buttons** are excluded from DFS traversal entirely (break in circuit)

#### Step 2: Find All Paths

`findAllPaths()` uses a **backtracking DFS** from battery+ (`posNode`) to battery− (`negNode`). Unlike a simple first-path search, it does **not stop** when it finds a path — it records the path, backtracks, and keeps searching:

```js
function dfs(cur) {
  if (cur === endNode) {
    allPaths.push([...path]);
    return;              // record and keep going — don't stop here
  }
  // try all reachable components, backtrack after each
}
```

This is what makes parallel circuits work. Three LEDs in parallel produce three separate paths, each evaluated independently.

#### Step 3: Evaluate Each Branch

For each path:

```
I = (V_battery − ΣV_forward) / ΣResistance
  = (9V − 2V) / 220Ω
  ≈ 31.8 mA
```

If `I ≥ 1 mA`, LEDs in that path light up (`emissiveIntensity = 2.2`, PointLight added to scene).

A `litLEDs` Set prevents double-processing when the same LED appears in more than one path.

#### Interactive Push Button

During simulation, an extra `click` listener is installed on the canvas that raycasts against button cap meshes. Clicking a cap calls `App.toggleButton(comp)`:

1. Flips `comp.pressed` (true ↔ false)
2. Animates the cap Y position (ease-out cubic, 80 ms) and colour (grey → green)
3. `App.runSimulation()` is called to re-evaluate all paths with the new switch state

The handler is installed **once** when simulation starts and stays alive for all re-runs — it is only removed when `App.stopSimulation()` is called.

---

### AI Tutor — IBM watsonx

#### Overview

The Sparky AI panel connects to `backend/server.js`, a plain Node.js HTTP server (zero npm dependencies) that calls the IBM watsonx text generation REST API. The model reads the board state as a markdown table and responds with natural language — and optionally a JSON block of actions to execute on the board.

#### Board State Serialization

`App.exportMarkdown()` converts the board into a markdown document:

```markdown
**Board status: 2 component(s), 3 wire(s)**

## Components
| ID         | Type     | Hole A          | Hole B          |
|------------|----------|-----------------|-----------------|
| resistor_0 | resistor | a3              | a7              |
| led_0      | led      | a9 (cathode−)   | a7 (anode+)     |

## Wires
| From  | To    | Color |
|-------|-------|-------|
| tp_3  | a3    | red   |
| a9    | tn_9  | black |
```

This gives the model precise hole addresses and connectivity without needing to understand 3D coordinates.

#### System Prompt Structure

```
BASE_PROMPT
  └── Role: friendly electronics tutor
  └── Breadboard rules: column sharing, center channel, rail wiring, LED polarity
  └── Reply style: 2-5 sentences, specific hole names, encouraging

TOOLS_ADDENDUM
  └── Component sizing rules (4 cols for resistor, 2 for LED, 3 for button)
  └── Step-by-step wiring recipe
  └── Three worked examples:
       • Single LED
       • Three LEDs in parallel
       • LED + push button
  └── Tool reference and wire naming conventions

BOARD STATE  (from exportMarkdown())

QUESTION: {user message}

ANSWER:
```

Stop sequences `['\nQUESTION:', '\nBOARD STATE:']` prevent the model from generating the next conversation turn itself.

#### Action Execution

The model can append a JSON actions block to its reply:

````
```actions
[
  { "tool": "place_battery" },
  { "tool": "place_resistor", "holeA": "a3",  "holeB": "a7" },
  { "tool": "place_led",      "holeA": "a9",  "holeB": "a7" },
  { "tool": "add_wire", "from": "tp_3", "to": "a3",  "color": "red"   },
  { "tool": "add_wire", "from": "a9",   "to": "tn_9","color": "black" }
]
```
````

The backend `parseActions()` extracts this (matching both ` ```actions ` and ` ```json ` fences). The frontend `sparkyExecActions()` iterates the array and calls the appropriate `App.*` functions. Wire endpoints are resolved by `execWire()` which handles both hole strings (`"a3"`, `"tp_5"`) and component pin strings (`"battery_0_pin0"`).

The model decides automatically whether to include an actions block based on whether the user is asking to build something or asking a question.

#### watsonx API Parameters

```
Endpoint: POST {WX_URL}/ml/v1/text/generation?version=2023-05-29
Model:     meta-llama/llama-3-3-70b-instruct
Tokens:    max_new_tokens: 1000
Temp:      0.3  (low = reliable, consistent JSON)
Auth:      IAM Bearer token (cached, refreshed 2 min before expiry)
```

---

### Save & Load

`App.saveCircuit()` serialises the board to JSON and triggers a browser download:

```json
{
  "version": 1,
  "components": [
    { "type": "resistor", "holeRefs": [{"col": 2, "row": "a"}, {"col": 6, "row": "a"}] },
    { "type": "led",      "holeRefs": [{"col": 8, "row": "a"}, {"col": 6, "row": "a"}] },
    { "type": "battery",  "position": { "x": 12.5, "z": 0 } }
  ],
  "wires": [
    { "startHole": {"col": 1, "row": "tp"}, "endHole": {"col": 2, "row": "a"}, "color": 16711748 }
  ]
}
```

`App.loadCircuit()` opens a file picker, reads the JSON, clears the board, then replays each component and wire to rebuild the scene exactly.

---

## Getting Started

### Running the 3D Designer (no AI)

Open `circuit3d/index.html` directly in a browser. No server required.

```bash
# Or serve the whole project with any static file server
npx serve .
```

### Running the AI Backend

Requires **Node.js 18+**. No npm install needed.

```bash
cd backend

# Create credentials file
cat > .env << EOF
WATSONX_APIKEY=your_api_key_here
WATSONX_PROJECT_ID=your_project_id_here
WATSONX_URL=https://us-south.ml.cloud.ibm.com
EOF

node server.js
# ⚡ Sparky AI → http://localhost:5000
```

The chat panel in the app connects to `http://localhost:5000` automatically.

### Getting IBM watsonx Credentials

1. Sign up at [IBM Cloud](https://cloud.ibm.com)
2. Create a **Watson Machine Learning** instance
3. Generate an API key under **Manage → Access (IAM) → API keys**
4. Create a project at [watsonx.ai](https://dataplatform.cloud.ibm.com) and copy the Project ID

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| 3D Rendering | Three.js r128 | Loaded from CDN — no bundler |
| Camera Controls | OrbitControls | Part of Three.js examples |
| Frontend | Vanilla JS / HTML / CSS | No frameworks, no npm |
| UI Font | Inter (Google Fonts) | |
| AI Backend | Node.js `http` module | Zero npm dependencies |
| AI Model | `meta-llama/llama-3-3-70b-instruct` | Hosted on IBM watsonx |
| Authentication | IBM IAM token exchange | Bearer token, cached with 2 min buffer |
| Persistence | Browser File API | `.sparky` JSON export/import |
| Build Tools | None | |

---

## Architecture Deep Dive

### Why Vanilla JS?

No build tools, no frameworks. The project opens directly in a browser from the file system, which keeps it accessible to beginners and removes all setup friction. The tradeoff is manual script ordering and the `window.App` namespace pattern instead of ES modules.

### Why Procedural 3D?

Three.js r128 is used without `GLTFLoader` because loading `.glb` files over `file://` triggers CORS errors in most browsers. All component geometry — leads, bodies, LED domes, button caps — is built from `CylinderGeometry`, `BoxGeometry`, `SphereGeometry`, and `TorusGeometry`. The app works fully offline with zero asset files.

### Simulation Engine Design

The simulation uses a **Union-Find** structure for connectivity and a **backtracking DFS** for path finding.

The backtracking DFS is the key design decision. A naive first-path DFS would find one path and stop — which means for three parallel LEDs, only the first would ever light up. By recording all paths and continuing the search after each one found, all parallel branches are evaluated independently. Each branch gets its own current calculation, so a 3-LED parallel circuit correctly shows all three LEDs at ~31.8 mA each.

### AI Action Loop

```
User message
    │
    ▼
App.exportMarkdown()  ──────→  markdown table of current board state
    │
    ▼
POST /api/ask  ─────────────→  IBM watsonx text generation
    │
    ▼
parseActions()  ────────────→  { reply: string, actions: array }
    │
    ├──→  display reply in chat panel
    │
    └──→  sparkyExecActions(actions)
               │
               ├── place_battery   → App.placeBattery()
               ├── place_resistor  → App.placeResistor()
               ├── place_led       → App.placeLED()
               ├── place_buzzer    → App.placeBuzzer()
               ├── place_button    → App.placeButton()
               ├── add_wire        → execWire() → App.finishWire()
               └── delete_all      → App.clearAll()
```

The model always has access to all tools and decides when to use them based on context — no special button needs to be pressed to "enable AI building mode".

---

*Built with ⚡ for the IBM Skills Build Hackathon*
