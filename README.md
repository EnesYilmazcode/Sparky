# Sparky

A 3D circuit designer that runs right in your browser. Drop components onto a breadboard, wire them up, simulate the circuit, and ask the built-in AI tutor for help.

![Sparky Circuit Designer](demo.png)

🏆 **1st Place Overall — IBM Skills Build Hackathon**

---

## What can it do?

- **Build circuits in 3D** — place resistors, LEDs, batteries, buzzers, and push buttons onto a realistic breadboard
- **Draw wires** between any two holes or pins, pick from 6 colors
- **Simulate** — hit play and watch LEDs light up, click buttons to open/close the circuit in real time
- **AI tutor** — ask Sparky a question and it explains what's going on, or tell it to build a circuit and it places the parts for you
- **Save and load** — export your circuits as `.sparky` files and share them

## Quick start

**Just the 3D designer (no AI):**

Open `circuit3d/index.html` in your browser. That's it. No install, no server, no npm.

**With the AI tutor:**

You'll need Node.js 18+ and an IBM watsonx API key.

```bash
cd backend

# Create a .env file with your credentials
cat > .env << EOF
WATSONX_APIKEY=your_api_key_here
WATSONX_PROJECT_ID=your_project_id_here
WATSONX_URL=https://us-south.ml.cloud.ibm.com
EOF

node server.js
```

Then open the app — the chat panel connects to `localhost:5000` automatically.

To get IBM watsonx credentials: sign up at [IBM Cloud](https://cloud.ibm.com), create a Watson Machine Learning instance, grab an API key from **Manage > Access (IAM) > API keys**, and create a project at [watsonx.ai](https://dataplatform.cloud.ibm.com) to get your Project ID.

## Controls

| Key | What it does |
| --- | --- |
| `S` | Select mode — click stuff to select it, then Delete to remove |
| `P` | Place mode — hover to preview, click to drop |
| `W` | Wire mode — click two holes/pins to connect them |
| `R` | Rotate component before placing |
| `Esc` | Cancel whatever you're doing |

You can also just click components in the sidebar to start placing them.

## How the simulation works

The simulator models the breadboard as a graph. Holes in the same column on the same side of the center channel are electrically connected (just like a real breadboard). Power rails run the full length of the board.

When you hit simulate, it:
1. Maps every hole and wire into a connectivity graph using Union-Find
2. Finds **all** paths from battery+ to battery- (not just the first one — this is what makes parallel circuits work)
3. Calculates current through each path: `I = (9V - LED voltage drops) / total resistance`
4. Lights up any LED getting enough current

Push buttons work during simulation too — click them to toggle the circuit on and off.

## How the AI works

When you send a message, the app snapshots your entire board (components, positions, wires) as a markdown table and sends it to IBM watsonx along with your question. The model can reply with text, or it can reply with a JSON block of actions like "place a resistor at a3-a7" and "wire tp_5 to a3" — the app executes those directly on the 3D board.

So you can literally type "build me an LED circuit" and watch it happen.

## Project structure

```
circuit3d/
  index.html          The app
  css/                 Styling
  js/
    scene.js           Three.js scene setup
    breadboard.js      Procedural breadboard geometry
    components.js      3D component models
    interaction.js     Mouse/keyboard handling
    simulate.js        Circuit simulation engine
    app.js             Ties everything together

backend/
  server.js            Talks to IBM watsonx (zero npm dependencies)
  .env                 Your credentials (not committed)
```

Everything is vanilla JS — no build tools, no frameworks, no bundler. The 3D components are all built from basic Three.js shapes (no external model files), so the whole app works offline from the file system.

## Tech stack

| What | How |
| --- | --- |
| 3D | Three.js r128 from CDN |
| Frontend | Plain HTML/CSS/JS |
| AI backend | Node.js http module, zero dependencies |
| AI model | Llama 3.3 70B on IBM watsonx |
| Auth | IBM IAM token exchange |

---

*Built for the IBM Skills Build Hackathon*
