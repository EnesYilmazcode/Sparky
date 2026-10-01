// ─────────────────────────────────────────────────────────────
//  board-model.js — the board as plain data, and the one place
//  that decides what a list of AI actions actually builds.
//
//  The browser and the server both run this file, so the circuit
//  the server verifies is the circuit the editor places.
//
//  Two rules live here:
//    • Ids are per type, in placement order: the first LED is led_0,
//      the second is led_1, the first battery is battery_0.
//    • One lead per hole. A lead or wire end aimed at a hole that is
//      already taken moves to the nearest free hole on the same strip
//      (same column and half, or the same rail), which keeps the
//      circuit identical and stops parts being drawn inside each other.
//
//  Browser: window.BoardModel.   Node: module.exports.
// ─────────────────────────────────────────────────────────────

(function (root, factory) {
  const M = factory();
  if (typeof module === 'object' && module.exports) module.exports = M;
  if (root) root.BoardModel = M;
})(typeof window !== 'undefined' ? window : null, function () {

  const COLS      = 50;
  const TOP_ROWS  = ['a', 'b', 'c', 'd', 'e'];
  const BOT_ROWS  = ['f', 'g', 'h', 'i', 'j'];
  const BODY_ROWS = TOP_ROWS.concat(BOT_ROWS);
  const RAIL_ROWS = ['tp', 'tn', 'bn', 'bp'];
  const ON_BOARD  = ['resistor', 'led', 'buzzer', 'button'];
  const TYPES     = ON_BOARD.concat(['battery']);
  const MAX_SPAN  = 12;

  const DEFAULTS = {
    resistor: { resistance: 470 },
    led:      { color: 'red' },
    buzzer:   {},
    button:   {},
    battery:  { voltage: 9 },
  };
  // Typical forward voltage per LED colour. components.js reads this too.
  const LED_VF = { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.2, white: 3.4 };
  const LED_COLORS = Object.keys(LED_VF);
  const WIRE_COLORS = ['red', 'yellow', 'green', 'blue', 'black', 'white'];

  // ── Hole addresses ──────────────────────────────────────────
  //  Body holes are "<row><col>" (e14); rails take an underscore
  //  (tp_14). Columns are 1-based in an address, 0-based in a ref.
  const HOLE_RE = /^(tp|tn|bn|bp)_(\d+)$|^([a-j])(\d+)$/i;
  const PIN_RE  = /^([a-z]+)_(\d+)_pin([01])$/i;

  function parseHole(str) {
    const m = HOLE_RE.exec(String(str || '').trim());
    if (!m) return null;
    const col = parseInt(m[2] || m[4], 10) - 1;
    if (!(col >= 0 && col < COLS)) return null;
    return { col, row: (m[1] || m[3]).toLowerCase() };
  }

  function formatHole(ref) {
    return ref.row + (RAIL_ROWS.includes(ref.row) ? '_' : '') + (ref.col + 1);
  }

  const holeKey = ref => ref.row + ':' + ref.col;

  // The strip a hole belongs to: every hole on it is the same node.
  function stripOf(ref) {
    if (RAIL_ROWS.includes(ref.row)) return ref.row;
    return (TOP_ROWS.includes(ref.row) ? 'top_' : 'bot_') + ref.col;
  }

  function stripHoles(ref) {
    if (RAIL_ROWS.includes(ref.row)) {
      return Array.from({ length: COLS }, (_, col) => ({ col, row: ref.row }));
    }
    const rows = TOP_ROWS.includes(ref.row) ? TOP_ROWS : BOT_ROWS;
    return rows.map(row => ({ col: ref.col, row }));
  }

  // ── Board ───────────────────────────────────────────────────
  function emptyBoard() { return { components: [], wires: [] }; }

  function clone(board) { return JSON.parse(JSON.stringify(board)); }

  function idsOf(board) {
    const seen = {};
    return board.components.map(c => {
      const k = seen[c.type] || 0;
      seen[c.type] = k + 1;
      return c.type + '_' + k;
    });
  }

  function findComponent(board, id) {
    const m = /^([a-z]+)_(\d+)$/i.exec(String(id || ''));
    if (!m) return -1;
    const type = m[1].toLowerCase(), k = parseInt(m[2], 10);
    let seen = 0;
    for (let i = 0; i < board.components.length; i++) {
      if (board.components[i].type !== type) continue;
      if (seen === k) return i;
      seen++;
    }
    return -1;
  }

  // Every hole that holds a lead or a wire end.
  function occupied(board) {
    const set = new Set();
    for (const c of board.components) (c.holes || []).forEach(h => set.add(holeKey(h)));
    for (const w of board.wires) {
      if (w.from.hole) set.add(holeKey(w.from.hole));
      if (w.to.hole)   set.add(holeKey(w.to.hole));
    }
    return set;
  }

  // Nearest free hole on the same strip, or null if the strip is full.
  function freeHoleNear(ref, taken) {
    if (!taken.has(holeKey(ref))) return ref;
    const cands = stripHoles(ref).filter(h => !taken.has(holeKey(h)));
    if (!cands.length) return null;
    const dist = h => RAIL_ROWS.includes(ref.row)
      ? Math.abs(h.col - ref.col)
      : Math.abs(BODY_ROWS.indexOf(h.row) - BODY_ROWS.indexOf(ref.row));
    cands.sort((a, b) => dist(a) - dist(b) || a.col - b.col);
    return cands[0];
  }

  // Where a two-lead part actually goes. A part lying along a row moves
  // to another row of the same half with both leads, so it stays
  // straight and each lead stays on its own strip. A part standing
  // along a column moves each lead up or down its own column.
  function placeHoles(hA, hB, taken) {
    const free = h => !taken.has(holeKey(h));
    if (free(hA) && free(hB)) return [hA, hB];
    if (hA.row === hB.row) {
      const rows = (TOP_ROWS.includes(hA.row) ? TOP_ROWS : BOT_ROWS).slice()
        .sort((x, y) => Math.abs(BODY_ROWS.indexOf(x) - BODY_ROWS.indexOf(hA.row)) -
                        Math.abs(BODY_ROWS.indexOf(y) - BODY_ROWS.indexOf(hA.row)));
      for (const row of rows) {
        const a = { col: hA.col, row }, b = { col: hB.col, row };
        if (free(a) && free(b)) return [a, b];
      }
      return null;
    }
    const t = new Set(taken);
    const a = freeHoleNear(hA, t);
    if (!a) return null;
    t.add(holeKey(a));
    const b = freeHoleNear(hB, t);
    return b ? [a, b] : null;
  }

  // ── Endpoints: a hole, or a component pin like battery_0_pin1 ─
  function parseEnd(board, str) {
    const hole = parseHole(str);
    if (hole) return { hole };
    const m = PIN_RE.exec(String(str || '').trim());
    if (m) {
      const idx = findComponent(board, m[1] + '_' + m[2]);
      if (idx >= 0 && !board.components[idx].holes) return { pin: { comp: idx, pin: +m[3] } };
      if (idx >= 0) {
        // An on-board part's pin is the hole its lead sits in.
        return { hole: board.components[idx].holes[+m[3]] };
      }
    }
    return null;
  }

  function endLabel(board, end) {
    if (end.hole) return formatHole(end.hole);
    return idsOf(board)[end.pin.comp] + '_pin' + end.pin.pin;
  }

  function cleanValues(type, a) {
    const v = Object.assign({}, DEFAULTS[type]);
    if (type === 'resistor' && Number(a.resistance) > 0) v.resistance = Math.round(Number(a.resistance));
    if (type === 'led' && LED_COLORS.includes(String(a.color || '').toLowerCase())) v.color = String(a.color).toLowerCase();
    if (type === 'led') v.forwardVoltage = LED_VF[v.color];
    return v;
  }

  // ── Applying actions ────────────────────────────────────────
  //  Returns the board after the actions, plus a resolved copy of
  //  every action that took effect (holes final, after any move), so
  //  the editor can replay exactly what was checked.
  function applyActions(start, actions) {
    const board = clone(start || emptyBoard());
    const resolved = [], notes = [], errors = [];

    (actions || []).forEach((a, i) => {
      const tool = a && a.tool;
      const where = `action ${i + 1} (${tool || 'unknown'})`;

      if (tool === 'delete_all') {
        board.components = []; board.wires = [];
        resolved.push({ tool });
        return;
      }

      if (tool === 'place_battery') {
        const slot = board.components.filter(c => c.type === 'battery').length;
        board.components.push({ type: 'battery', holes: null, values: cleanValues('battery', a), slot });
        resolved.push({ tool, slot });
        return;
      }

      const place = /^place_(resistor|led|buzzer|button)$/.exec(tool || '');
      if (place) {
        const type = place[1];
        let hA = parseHole(a.holeA), hB = parseHole(a.holeB);
        if (!hA || !hB) { errors.push(`${where}: "${a.holeA}" / "${a.holeB}" is not a board hole.`); return; }
        const sameRow = hA.row === hB.row, sameCol = hA.col === hB.col;
        const span = sameRow ? Math.abs(hA.col - hB.col)
                   : sameCol ? Math.abs(BODY_ROWS.indexOf(hA.row) - BODY_ROWS.indexOf(hB.row)) : -1;
        if (span < 1 || span > MAX_SPAN) {
          errors.push(`${where}: ${a.holeA} and ${a.holeB} must be on one row or one column, 1 to ${MAX_SPAN} holes apart.`);
          return;
        }
        if (RAIL_ROWS.includes(hA.row) || RAIL_ROWS.includes(hB.row)) {
          errors.push(`${where}: parts go in body holes (a-j); only wires go into the rails.`);
          return;
        }
        const spot = placeHoles(hA, hB, occupied(board));
        if (!spot) { errors.push(`${where}: no free straight position on the strips of ${a.holeA} and ${a.holeB}.`); return; }
        const [fA, fB] = spot;
        if (holeKey(fA) !== holeKey(hA) || holeKey(fB) !== holeKey(hB)) {
          notes.push(`${type} moved from ${formatHole(hA)}/${formatHole(hB)} to ${formatHole(fA)}/${formatHole(fB)}, same connections.`);
        }
        const values = cleanValues(type, a);
        const comp = { type, holes: [fA, fB], values };
        if (type === 'button') comp.pressed = false;
        board.components.push(comp);
        const r = { tool, holeA: formatHole(fA), holeB: formatHole(fB) };
        if (type === 'resistor') r.resistance = values.resistance;
        if (type === 'led') r.color = values.color;
        resolved.push(r);
        return;
      }

      if (tool === 'add_wire') {
        const from = parseEnd(board, a.from), to = parseEnd(board, a.to);
        if (!from || !to) { errors.push(`${where}: cannot find "${!from ? a.from : a.to}".`); return; }
        const taken = occupied(board);
        for (const end of [from, to]) {
          if (!end.hole) continue;
          const f = freeHoleNear(end.hole, taken);
          if (!f) { errors.push(`${where}: no free hole left next to ${formatHole(end.hole)}.`); return; }
          if (holeKey(f) !== holeKey(end.hole)) notes.push(`wire end moved from ${formatHole(end.hole)} to ${formatHole(f)}, same connection.`);
          end.hole = f;
          taken.add(holeKey(f));
        }
        if (from.hole && to.hole && stripOf(from.hole) === stripOf(to.hole)) {
          notes.push(`the wire ${formatHole(from.hole)} to ${formatHole(to.hole)} joins two holes that were already connected.`);
        }
        const color = WIRE_COLORS.includes(String(a.color || '').toLowerCase()) ? String(a.color).toLowerCase() : 'red';
        board.wires.push({ from, to, color });
        resolved.push({ tool, from: endLabel(board, from), to: endLabel(board, to), color });
        return;
      }

      if (tool === 'remove_component') {
        const idx = findComponent(board, a.id);
        if (idx < 0) { errors.push(`${where}: no component called "${a.id}".`); return; }
        const removed = board.components[idx];
        const label = idsOf(board)[idx];
        // Wires on its holes stay (they still plug into the board);
        // wires on its off-board pins go with it.
        board.wires = board.wires.filter(w => !(w.from.pin && w.from.pin.comp === idx) && !(w.to.pin && w.to.pin.comp === idx));
        board.wires.forEach(w => [w.from, w.to].forEach(e => { if (e.pin && e.pin.comp > idx) e.pin.comp--; }));
        board.components.splice(idx, 1);
        resolved.push({ tool, id: label, type: removed.type });
        return;
      }

      if (tool === 'remove_wire') {
        const want = [String(a.from || '').toLowerCase(), String(a.to || '').toLowerCase()];
        const idx = board.wires.findIndex(w => {
          const got = [endLabel(board, w.from), endLabel(board, w.to)];
          return (got[0] === want[0] && got[1] === want[1]) || (got[0] === want[1] && got[1] === want[0]);
        });
        if (idx < 0) { errors.push(`${where}: no wire from ${a.from} to ${a.to}.`); return; }
        board.wires.splice(idx, 1);
        resolved.push({ tool, from: a.from, to: a.to });
        return;
      }

      errors.push(`${where}: unknown tool.`);
    });

    return { board, resolved, notes, errors };
  }

  // ── Plain data in and out ───────────────────────────────────
  //  The editor exports { components:[{type, holes:["a5","a9"]|null,
  //  values, pressed}], wires:[{from:"tp_5", to:"battery_0_pin0", color}] }.
  function fromExport(data) {
    const board = emptyBoard();
    for (const c of (data && data.components) || []) {
      if (!TYPES.includes(c.type)) continue;
      const holes = c.holes ? c.holes.map(parseHole) : null;
      if (holes && holes.some(h => !h)) continue;
      const comp = { type: c.type, holes, values: Object.assign({}, DEFAULTS[c.type], c.values || {}) };
      if (c.type === 'button') comp.pressed = !!c.pressed;
      board.components.push(comp);
    }
    for (const w of (data && data.wires) || []) {
      const from = parseEnd(board, w.from), to = parseEnd(board, w.to);
      if (from && to) board.wires.push({ from, to, color: w.color || 'red' });
    }
    return board;
  }

  function toExport(board) {
    return {
      components: board.components.map(c => {
        const o = { type: c.type, holes: c.holes ? c.holes.map(formatHole) : null, values: c.values };
        if (c.type === 'button') o.pressed = !!c.pressed;
        return o;
      }),
      wires: board.wires.map(w => ({ from: endLabel(board, w.from), to: endLabel(board, w.to), color: w.color })),
    };
  }

  // The shape simulate.js analyze() takes. `props` is simulate.js PROPS,
  // the defaults a part's own values sit on top of.
  function toSim(board, props) {
    const pin = () => ({ x: 0, y: 0, z: 0 });
    const components = board.components.map(c => {
      const values = Object.assign({}, (props && props[c.type]) || {}, c.values);
      const o = { type: c.type, pins: [pin(), pin()], holeRefs: c.holes ? c.holes.map(h => ({ col: h.col, row: h.row })) : null, values };
      if (c.type === 'button') o.pressed = !!c.pressed;
      return o;
    });
    const wires = board.wires.map(w => {
      const o = {};
      if (w.from.hole) o.startHole = { col: w.from.hole.col, row: w.from.hole.row };
      else { o.startComp = components[w.from.pin.comp]; o.startPinIdx = w.from.pin.pin; }
      if (w.to.hole) o.endHole = { col: w.to.hole.col, row: w.to.hole.row };
      else { o.endComp = components[w.to.pin.comp]; o.endPinIdx = w.to.pin.pin; }
      return o;
    });
    return { components, wires };
  }

  return {
    COLS, BODY_ROWS, RAIL_ROWS, TOP_ROWS, BOT_ROWS, LED_VF, LED_COLORS, WIRE_COLORS,
    parseHole, formatHole, stripOf, freeHoleNear, holeKey,
    emptyBoard, idsOf, findComponent, occupied,
    applyActions, fromExport, toExport, toSim,
  };
});
