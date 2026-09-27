// ─────────────────────────────────────────────────────────────
//  chat.js — the Sparky panel: ask, preview, apply
//
//  No model key in the browser. The prompt, tools and the simulator
//  check live in backend/server.js behind /api/ask.
//
//  Every action list, from the server or anywhere else, is replayed
//  through board-model.js against the board as it is now. That one
//  pass decides the real holes (a lead never lands in a taken hole),
//  so the preview, the placement and the server's check agree.
// ─────────────────────────────────────────────────────────────

(function () {
  const BM = window.BoardModel;
  const history = [];          // { role: 'user' | 'model', text }
  let pending = null;          // { actions, ghosts, tinted }

  const WIRE_HEX = { red: 0xef4444, yellow: 0xfbbf24, green: 0x22c55e, blue: 0x3b82f6, black: 0x111111, white: 0xffffff };

  const $ = id => document.getElementById(id);

  // The API runs on the Render service, which also serves these pages. The
  // copy on Firebase Hosting has no server behind it, so it calls Render
  // across origins; the server's CORS list names the web.app hosts.
  const API_BASE = /\.web\.app$/.test(location.hostname) ? 'https://sparky-na2c.onrender.com' : '';

  // ── Server ───────────────────────────────────────────────────
  async function askSparky(message) {
    const res = await fetch(API_BASE + '/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: history.slice(-20),
        markdown: App.exportMarkdown(),
        board: App.exportBoard(),
      }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* an HTML error page */ }
    if (!res.ok || !data) {
      throw new Error((data && data.reply) || 'Sparky could not reach the AI service. Please try again in a moment.');
    }
    return {
      reply: data.reply || '',
      actions: Array.isArray(data.actions) ? data.actions : [],
      notes: Array.isArray(data.notes) ? data.notes : [],
      verification: data.verification || null,
    };
  }

  // ── Messages ─────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Small, safe markdown: escaped first, then **bold**, `code` and lists.
  function renderMarkdown(text) {
    const inline = s => escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const out = [];
    let list = null;
    for (const raw of String(text).split('\n')) {
      const line = raw.trimEnd();
      const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
      if (li) {
        if (!list) { list = []; }
        list.push('<li>' + inline(li[1]) + '</li>');
        continue;
      }
      if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; }
      if (line.trim()) out.push('<p>' + inline(line) + '</p>');
    }
    if (list) out.push('<ul>' + list.join('') + '</ul>');
    return out.join('');
  }

  function scrollDown() {
    const box = $('sparky-messages');
    box.scrollTop = box.scrollHeight;
  }

  function addMsg(text, role) {
    $('sparky-welcome')?.classList.add('hidden');
    const el = document.createElement('div');
    el.className = 'chat-msg ' + role;
    if (role === 'ai') el.innerHTML = renderMarkdown(text);
    else el.textContent = text;
    $('sparky-messages').appendChild(el);
    scrollDown();
    return el;
  }

  function addTyping() {
    $('sparky-welcome')?.classList.add('hidden');
    const el = document.createElement('div');
    el.className = 'chat-msg typing';
    el.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div><span class="typing-label">Building and checking…</span>';
    $('sparky-messages').appendChild(el);
    scrollDown();
    return el;
  }

  const ICON_OK   = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const ICON_WARN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';

  // "Checked in the simulator: the red LED lights." to a heading and a sentence.
  function splitVerdict(summary) {
    const m = /^(Checked in [^:]+): (.*)$/.exec(summary || '');
    return m ? { head: m[1], body: m[2].charAt(0).toUpperCase() + m[2].slice(1) } : { head: null, body: summary || '' };
  }

  // The simulator's verdict on a proposed build, shown under the reply.
  function addVerification(v, notes) {
    const el = document.createElement('div');
    el.className = 'verify ' + (v.ok ? 'ok' : 'bad');
    const tries = v.attempts > 1 ? `Took ${v.attempts} tries` : '';
    const moved = notes && notes.length ? `${notes.length} lead${notes.length > 1 ? 's' : ''} moved` : '';
    const verdict = splitVerdict(v.summary);
    el.innerHTML =
      `<div class="verify-head">${v.ok ? ICON_OK : ICON_WARN}<span>${escapeHtml(v.ok ? verdict.head || 'Checked in the simulator' : 'Not working yet')}</span></div>` +
      `<div class="verify-body">${escapeHtml(verdict.body)}</div>` +
      (!v.ok && v.problems && v.problems.length
        ? '<ul class="verify-problems">' + v.problems.slice(0, 4).map(p => `<li>${escapeHtml(p)}</li>`).join('') + '</ul>' : '') +
      ((tries || moved) ? `<div class="verify-meta">${escapeHtml([tries, moved].filter(Boolean).join(' · '))}</div>` : '');
    $('sparky-messages').appendChild(el);
    scrollDown();
  }

  // ── Local check, used when the server did not send one ───────
  function localVerify(actions) {
    const r = BM.applyActions(BM.fromExport(App.exportBoard()), actions);
    const outputs = r.board.components.filter(c => c.type === 'led' || c.type === 'buzzer');
    if (!outputs.length && !r.errors.length) return null;
    const run = pressAll => {
      const b = JSON.parse(JSON.stringify(r.board));
      if (pressAll) b.components.forEach(c => { if (c.type === 'button') c.pressed = true; });
      const sim = BM.toSim(b, App.PROPS);
      return App.simAnalyze(sim.components, sim.wires);
    };
    let out = run(false), viaButton = false;
    if (out.ledsOn.length + out.buzzersOn.length < outputs.length && r.board.components.some(c => c.type === 'button')) {
      const pressed = run(true);
      if (pressed.ledsOn.length + pressed.buzzersOn.length > out.ledsOn.length + out.buzzersOn.length) { out = pressed; viaButton = true; }
    }
    const working = out.ledsOn.length + out.buzzersOn.length;
    const shorted = out.branches.some(b => b.shorted);
    const ok = !r.errors.length && !shorted && working === outputs.length;
    const leds = r.board.components.filter(c => c.type === 'led').length;
    const summary = ok
      ? `Checked in your browser: ${working === 1 ? 'the output works' : `all ${working} outputs work`}${viaButton ? ' when you press the button' : ''}.`
      : shorted ? 'Checked in your browser: this build shorts the battery.'
      : `Checked in your browser: ${working} of ${outputs.length} output${outputs.length > 1 ? 's' : ''} work${leds ? '' : ''}.`;
    return { ok, summary, problems: r.errors.concat(out.lines.filter(l => /sim-(warn|err)/.test(l.cls)).map(l => l.text.trim())), attempts: 1 };
  }

  // ── Building ─────────────────────────────────────────────────
  function holeObj(addr) {
    const h = BM.parseHole(addr);
    return h ? App.state.breadboard.getHole(h.col, h.row) : null;
  }

  function batteryByIndex(k) {
    return App.state.components.filter(c => c.type === 'battery')[k] || null;
  }

  function wireEnd(str) {
    const hole = holeObj(str);
    if (hole) return { world: hole.world.clone(), holeRef: { col: hole.col, row: hole.row }, pinMesh: null };
    const m = /^battery_(\d+)_pin([01])$/i.exec(str || '');
    const bat = m && batteryByIndex(+m[1]);
    const pm = bat && bat.pinMeshes[+m[2]];
    return pm ? { world: pm.userData.world.clone(), holeRef: null, pinMesh: pm } : null;
  }

  function execOne(a) {
    const place = /^place_(resistor|led|buzzer|button)$/.exec(a.tool);
    if (place) {
      const hA = holeObj(a.holeA), hB = holeObj(a.holeB);
      if (!hA || !hB) return false;
      const fn = { resistor: App.placeResistor, led: App.placeLED, buzzer: App.placeBuzzer, button: App.placeButton }[place[1]];
      fn(hA, hB, place[1] === 'resistor' ? { resistance: a.resistance } : place[1] === 'led' ? { color: a.color } : undefined);
      return true;
    }
    switch (a.tool) {
      case 'delete_all':
        App.clearBoard();
        return true;
      case 'place_battery': {
        const n = App.state.components.filter(c => c.type === 'battery').length;
        const p = App.batterySlot(a.slot ?? n);
        App.placeBattery(p.x, p.z);
        return true;
      }
      case 'add_wire': {
        const s = wireEnd(a.from), e = wireEnd(a.to);
        if (!s || !e) return false;
        const saved = App.state.wireColor;
        App.state.wireColor = WIRE_HEX[a.color] ?? saved;
        App.state.wireStart = s;
        App.finishWire(e);
        App.state.wireColor = saved;
        return true;
      }
      case 'remove_component': {
        const i = App.componentIds().indexOf(a.id);
        return i >= 0 && App.removeComponent(App.state.components[i]);
      }
      case 'remove_wire': {
        const w = App.state.wires.find(w => {
          const [f, t] = App.wireLabels(w);
          return (f === a.from && t === a.to) || (f === a.to && t === a.from);
        });
        return App.removeWire(w);
      }
    }
    return false;
  }

  // Replay actions on the current board; one undo step for the lot.
  function execActions(actions) {
    const r = BM.applyActions(BM.fromExport(App.exportBoard()), actions);
    let done = 0;
    App.batch(() => { r.resolved.forEach(a => { if (execOne(a)) done++; }); });
    if (App.simRunning) App.runSimulation();
    return { done, notes: r.notes, errors: r.errors };
  }

  // ── Preview: ghosts of what the actions would build ──────────
  const ghostWire = new Map();
  function ghostWireMat(hex) {
    if (!ghostWire.has(hex)) ghostWire.set(hex, new THREE.MeshStandardMaterial({ color: hex, transparent: true, opacity: 0.5, depthWrite: false }));
    return ghostWire.get(hex);
  }

  function preview(actions) {
    clearPreview();
    const r = BM.applyActions(BM.fromExport(App.exportBoard()), actions);
    if (!r.resolved.length) return false;
    const ghosts = [], tinted = [];
    const REMOVE = 0xdc2626;
    const tint = g => { if (g && !tinted.includes(g)) { App.setHighlight(g, true, REMOVE); tinted.push(g); } };

    const ids = App.componentIds();
    const batPins = {};
    App.state.components.forEach((c, i) => { if (c.type === 'battery') batPins[ids[i]] = c.pins; });
    let batteries = App.state.components.filter(c => c.type === 'battery').length;
    const bb = App.state.breadboard;
    const at = addr => { const h = BM.parseHole(addr); return h ? bb.getHole(h.col, h.row) : null; };

    for (const a of r.resolved) {
      if (a.tool === 'delete_all') {
        App.state.components.forEach(c => tint(c.group));
        App.state.wires.forEach(w => tint(w.group));
        Object.keys(batPins).forEach(k => delete batPins[k]);
        batteries = 0;
      } else if (a.tool === 'place_battery') {
        const p = App.batterySlot(batteries);
        const g = App.buildPreview('battery', null, null, true);
        g.position.set(p.x, 0, p.z);
        ghosts.push(g);
        batPins['battery_' + batteries] = App.batteryPinsAt(p.x, p.z);
        batteries++;
      } else if (/^place_/.test(a.tool)) {
        const g = App.buildPreview(a.tool.slice(6), at(a.holeA), at(a.holeB), true, { resistance: a.resistance, color: a.color });
        if (g) ghosts.push(g);
      } else if (a.tool === 'add_wire') {
        const end = str => {
          const h = at(str);
          if (h) return h.world.clone();
          const m = /^(battery_\d+)_pin([01])$/.exec(str);
          return m && batPins[m[1]] ? batPins[m[1]][+m[2]].clone() : null;
        };
        const s = end(a.from), e = end(a.to);
        if (s && e) ghosts.push(App.buildWire(s, e, WIRE_HEX[a.color] ?? 0xef4444, { material: ghostWireMat(WIRE_HEX[a.color] ?? 0xef4444) }));
      } else if (a.tool === 'remove_component') {
        const i = App.componentIds().indexOf(a.id);
        if (i >= 0) tint(App.state.components[i].group);
      } else if (a.tool === 'remove_wire') {
        const w = App.state.wires.find(w => {
          const [f, t] = App.wireLabels(w);
          return (f === a.from && t === a.to) || (f === a.to && t === a.from);
        });
        if (w) tint(w.group);
      }
    }
    ghosts.forEach(g => App.scene.add(g));
    pending = { actions, ghosts, tinted };
    App.previewing = true;
    App.refreshCounts();
    const n = r.resolved.length;
    $('sparky-pending-count').textContent = `${n} change${n === 1 ? '' : 's'} ready`;
    $('sparky-pending-bar').style.display = 'flex';
    return true;
  }

  function clearPreview() {
    if (!pending) return;
    pending.ghosts.forEach(g => { App.scene.remove(g); App.disposeGroup(g); });
    pending.tinted.forEach(g => App.setHighlight(g, false));
    pending = null;
    App.previewing = false;
    App.refreshCounts();
    $('sparky-pending-bar').style.display = 'none';
  }

  function accept() {
    if (!pending) return;
    const actions = pending.actions;
    clearPreview();
    const r = execActions(actions);
    addMsg(`Applied ${r.done} change${r.done !== 1 ? 's' : ''}.`, 'system');
  }

  function decline() {
    if (!pending) return;
    clearPreview();
    addMsg('Discarded.', 'system');
  }

  // ── Main ask ─────────────────────────────────────────────────
  let busy = false;
  async function ask(override) {
    const input = $('sparky-input');
    const msg = (override !== undefined ? override : input.value).trim();
    if (!msg || busy) return;
    busy = true;
    $('sparky-send')?.setAttribute('disabled', '');
    clearPreview();
    addMsg(msg, 'user');
    input.value = '';
    input.style.height = 'auto';
    const typing = addTyping();
    try {
      const data = await askSparky(msg);
      typing.remove();
      const v = data.actions.length ? (data.verification || localVerify(data.actions)) : null;
      // The reply ends with the verdict; the card under it says it once.
      const said = v && v.summary ? (data.reply || '').replace(v.summary, '').trim() : data.reply;
      addMsg(said || 'Here is the build.', 'ai');
      history.push({ role: 'user', text: msg }, { role: 'model', text: data.reply || '' });
      if (data.actions.length) {
        if (v) addVerification(v, data.notes);
        preview(data.actions);
      }
    } catch (err) {
      typing.remove();
      addMsg(err.message, 'system');
    } finally {
      busy = false;
      $('sparky-send')?.removeAttribute('disabled');
    }
  }

  function clearChat() {
    clearPreview();
    history.length = 0;
    $('sparky-messages').querySelectorAll('.chat-msg, .verify').forEach(el => el.remove());
    $('sparky-welcome')?.classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const inp = $('sparky-input');
    if (!inp) return;
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
    });
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
    });
    $('sparky-send')?.addEventListener('click', () => ask());
    $('sparky-clear')?.addEventListener('click', clearChat);
  });

  // Inline handlers in index.html, and the audit harness, call these.
  window.sparkyAsk            = ask;
  window.sparkyQuick          = msg => ask(msg);
  window.sparkyAcceptChanges  = accept;
  window.sparkyDeclineChanges = decline;
  window.sparkyExecActions    = actions => execActions(actions).done;
  window.sparkyPreviewActions = preview;
})();
