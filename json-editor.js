// Visual editor for the Final Prompt when it contains JSON.
// The textarea stays the source of truth: every visual edit rewrites it as pretty JSON.
(function () {
  'use strict';
  const ta = document.getElementById('finalPrompt');
  const promptBox = ta && ta.closest('.prompt-box');
  if (!ta || !promptBox) return;

  const MODE_KEY = 'pb-json-view-v1';
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  let mode = 'visual';
  try { mode = localStorage.getItem(MODE_KEY) === 'text' ? 'text' : 'visual'; } catch { /* ignore */ }
  let data = null;
  let repaired = false;
  let internal = false;
  let focusChipsOf = null;

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const button = (cls, text, title) => {
    const b = h('button', cls, text);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    return b;
  };
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isPrimArray = a => a.every(x => x === null || typeof x !== 'object');
  const isHex = s => typeof s === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s);
  const labelFor = k => typeof k === 'number'
    ? 'Item ' + (k + 1)
    : String(k).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());

  function tryParse(text) {
    let t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!/^[[{]/.test(t)) return null;
    try { return { value: JSON.parse(t), repaired: false }; } catch { /* try repair */ }
    // Common AI slips: unquoted bare words as values and trailing commas.
    const fixed = t
      .replace(/:\s*([A-Za-z_][\w.-]*)(\s*[,}\]])/g, (m, w, end) => /^(true|false|null)$/.test(w) ? m : `: "${w}"${end}`)
      .replace(/,(\s*[}\]])/g, '$1');
    try { return { value: JSON.parse(fixed), repaired: true }; } catch { return null; }
  }

  // ---- toolbar / container ----
  const toolbar = h('div', 'json-toolbar');
  toolbar.hidden = true;
  const seg = h('div', 'seg');
  const btnVisual = button('seg-btn', 'Visual');
  const btnText = button('seg-btn', 'Text');
  seg.append(btnVisual, btnText);
  const badge = h('span', 'json-badge');
  const fixBtn = button('json-link', 'Apply fix', 'Rewrite the text as valid JSON');
  fixBtn.hidden = true;
  const spacer = h('span', 'json-spacer');
  const expandBtn = button('json-link', 'Expand all');
  const collapseBtn = button('json-link', 'Collapse all');
  toolbar.append(seg, badge, fixBtn, spacer, expandBtn, collapseBtn);
  const editor = h('div', 'json-editor');
  editor.hidden = true;
  promptBox.before(toolbar);
  promptBox.after(editor);

  function commit() {
    internal = true;
    nativeValue.set.call(ta, JSON.stringify(data, null, 2));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    internal = false;
    if (repaired) { repaired = false; updateChrome(); }
  }

  function updateChrome() {
    const looksJson = /^\s*(```(?:json)?\s*)?[[{]/i.test(ta.value);
    toolbar.hidden = !looksJson;
    const useVisual = !!data && mode === 'visual';
    editor.hidden = !useVisual;
    promptBox.hidden = useVisual;
    btnVisual.disabled = !data;
    btnVisual.classList.toggle('active', useVisual);
    btnText.classList.toggle('active', !useVisual);
    expandBtn.hidden = collapseBtn.hidden = !useVisual;
    fixBtn.hidden = !(data && repaired);
    badge.classList.toggle('warn', !data || repaired);
    if (!data) badge.textContent = 'Not valid JSON — edit in Text view';
    else if (repaired) badge.textContent = 'JSON had errors and was auto-fixed in the editor';
    else badge.textContent = Array.isArray(data) ? `JSON list · ${data.length} items` : `JSON · ${Object.keys(data).length} fields`;
    return useVisual;
  }

  function sync(rerender) {
    const parsed = tryParse(ta.value);
    data = parsed ? parsed.value : null;
    repaired = !!(parsed && parsed.repaired);
    if (data !== null && typeof data !== 'object') data = null;
    if (updateChrome() && rerender) render();
  }

  function setMode(next) {
    mode = next;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
    if (updateChrome()) render();
  }

  // ---- rendering ----
  function render() {
    const top = editor.scrollTop;
    editor.textContent = '';
    editor.append(Array.isArray(data) ? renderArrayBody(data, 0) : renderObjectBody(data, 0));
    editor.scrollTop = top;
  }

  function blankLike(v) {
    if (Array.isArray(v)) return [];
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankLike(x)]));
    if (typeof v === 'number') return 0;
    if (typeof v === 'boolean') return false;
    return typeof v === 'string' ? '' : null;
  }

  function itemTitle(v, i) {
    const name = ['name', 'title', 'label', 'id'].map(k => v[k]).find(x => typeof x === 'string' && x.trim());
    return `Item ${i + 1}` + (name ? ` · ${name.slice(0, 40)}` : '');
  }

  function delBtn(onRemove) {
    const b = button('je-del', '×', 'Remove');
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onRemove(); });
    return b;
  }

  function group(label, body, onRemove, open, meta) {
    const d = h('details', 'je-group');
    d.open = open;
    const s = h('summary');
    s.append(h('span', 'je-gtitle', label));
    if (meta) s.append(h('span', 'je-meta', meta));
    s.append(delBtn(onRemove));
    d.append(s, body);
    return d;
  }

  function renderObjectBody(obj, depth) {
    const body = h('div', 'je-body');
    Object.keys(obj).forEach(k => body.append(renderEntry(obj, k, depth, () => { delete obj[k]; commit(); render(); })));
    body.append(renderAddField(obj));
    return body;
  }

  function renderArrayBody(arr, depth) {
    const body = h('div', 'je-body');
    if (isPrimArray(arr)) { body.append(renderChips(arr)); return body; }
    arr.forEach((_, i) => body.append(renderEntry(arr, i, depth, () => { arr.splice(i, 1); commit(); render(); })));
    const add = button('json-link je-add-btn', '+ Add item');
    add.addEventListener('click', () => {
      arr.push(arr.length ? blankLike(arr[arr.length - 1]) : {});
      commit(); render();
    });
    body.append(add);
    return body;
  }

  function renderEntry(holder, key, depth, onRemove) {
    const v = holder[key];
    const inArray = Array.isArray(holder);
    if (isObj(v)) {
      const label = inArray ? itemTitle(v, key) : labelFor(key);
      return group(label, renderObjectBody(v, depth + 1), onRemove, depth < 1 || (inArray && key === 0), `${Object.keys(v).length} fields`);
    }
    if (Array.isArray(v) && !isPrimArray(v)) {
      return group(labelFor(key), renderArrayBody(v, depth + 1), onRemove, depth < 1, `${v.length} items`);
    }
    const row = h('div', 'je-row');
    const lab = h('label', 'je-key', labelFor(key));
    lab.title = String(key);
    const ctl = h('div', 'je-ctl');
    ctl.append(Array.isArray(v) ? renderChips(v) : renderPrimitive(holder, key));
    row.append(lab, ctl, delBtn(onRemove));
    return row;
  }

  function renderPrimitive(holder, key) {
    const v = holder[key];
    if (typeof v === 'boolean') {
      const wrap = h('div', 'je-bool');
      const sw = h('label', 'switch');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = v;
      sw.append(cb, document.createElement('span'));
      const state = h('span', 'je-boolval', v ? 'Yes' : 'No');
      cb.addEventListener('change', () => { holder[key] = cb.checked; state.textContent = cb.checked ? 'Yes' : 'No'; commit(); });
      wrap.append(sw, state);
      return wrap;
    }
    if (typeof v === 'number') {
      const inp = h('input', 'je-input');
      inp.type = 'number';
      inp.step = 'any';
      inp.value = String(v);
      inp.addEventListener('input', () => {
        const n = Number(inp.value);
        if (inp.value.trim() !== '' && Number.isFinite(n)) { holder[key] = n; commit(); }
      });
      return inp;
    }
    const text = v == null ? '' : String(v);
    const multiline = text.length > 70 || text.includes('\n');
    const inp = multiline ? h('textarea', 'je-text') : h('input', 'je-input');
    if (!multiline) inp.type = 'text';
    else inp.rows = Math.min(6, Math.ceil(text.length / 60) + (text.match(/\n/g) || []).length);
    inp.value = text;
    if (v == null) inp.placeholder = 'null';
    inp.spellcheck = false;
    if (isHex(text) && !multiline) return colorControl(holder, key, inp);
    inp.addEventListener('input', () => { holder[key] = inp.value; commit(); });
    return inp;
  }

  function colorControl(holder, key, inp) {
    const wrap = h('div', 'je-color');
    const pick = document.createElement('input');
    pick.type = 'color';
    const toSix = s => s.length === 4 || s.length === 5 ? '#' + [...s.slice(1, 4)].map(c => c + c).join('') : s.slice(0, 7);
    pick.value = toSix(inp.value).toLowerCase();
    pick.addEventListener('input', () => {
      const alpha = inp.value.length === 9 ? inp.value.slice(7) : '';
      inp.value = pick.value.toUpperCase() + alpha;
      holder[key] = inp.value;
      commit();
    });
    inp.addEventListener('input', () => {
      holder[key] = inp.value;
      pick.classList.toggle('dim', !isHex(inp.value));
      if (isHex(inp.value)) pick.value = toSix(inp.value).toLowerCase();
      commit();
    });
    wrap.append(pick, inp);
    return wrap;
  }

  function renderChips(arr) {
    const wrap = h('div', 'je-chips');
    const isNum = typeof arr.find(x => x != null) === 'number';
    const toValue = (raw, prev) => {
      if (isNum || typeof prev === 'number') {
        const n = Number(raw);
        return raw.trim() !== '' && Number.isFinite(n) ? n : prev;
      }
      return raw;
    };
    arr.forEach((val, i) => {
      const chip = h('span', 'je-chip');
      const dot = isHex(val) ? h('span', 'je-dot') : null;
      if (dot) { dot.style.background = val; chip.append(dot); }
      const inp = h('input');
      inp.type = 'text';
      inp.value = String(val);
      inp.size = Math.max(3, inp.value.length + 1);
      inp.addEventListener('input', () => {
        arr[i] = toValue(inp.value, arr[i]);
        inp.size = Math.max(3, inp.value.length + 1);
        if (dot) dot.style.background = isHex(inp.value) ? inp.value : 'transparent';
        commit();
      });
      const rm = button('', '×', 'Remove');
      rm.addEventListener('click', () => { arr.splice(i, 1); commit(); render(); });
      chip.append(inp, rm);
      wrap.append(chip);
    });
    const add = h('input', 'je-chip-add');
    add.type = 'text';
    add.placeholder = '+ Add';
    const push = () => {
      const raw = add.value.trim();
      add.value = '';
      if (!raw) return;
      const v = toValue(raw, undefined);
      if (v === undefined) return;
      arr.push(v);
      focusChipsOf = arr;
      commit(); render();
    };
    add.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); push(); } });
    add.addEventListener('blur', () => { if (add.value.trim()) { focusChipsOf = null; push(); } });
    wrap.append(add);
    if (focusChipsOf === arr) { focusChipsOf = null; setTimeout(() => add.focus(), 0); }
    return wrap;
  }

  function renderAddField(obj) {
    const wrap = h('div', 'je-add');
    const open = button('json-link je-add-btn', '+ Add field');
    wrap.append(open);
    open.addEventListener('click', () => {
      wrap.textContent = '';
      const key = h('input', 'je-input');
      key.type = 'text';
      key.placeholder = 'Field name';
      const type = h('select', 'je-input je-type');
      [['text', 'Text'], ['number', 'Number'], ['bool', 'Yes / No'], ['list', 'List'], ['group', 'Group']]
        .forEach(([v, l]) => { const o = h('option', '', l); o.value = v; type.append(o); });
      const ok = button('secondary small', 'Add');
      const cancel = button('json-link', 'Cancel');
      const hint = h('span', 'field-hint');
      const submit = () => {
        const name = key.value.trim();
        if (!name) { hint.textContent = 'Enter a field name.'; return; }
        if (Object.prototype.hasOwnProperty.call(obj, name)) { hint.textContent = 'Field already exists.'; return; }
        obj[name] = { text: '', number: 0, bool: false, list: [], group: {} }[type.value];
        commit(); render();
      };
      ok.addEventListener('click', submit);
      cancel.addEventListener('click', render);
      key.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { e.preventDefault(); render(); }
      });
      wrap.append(key, type, ok, cancel, hint);
      key.focus();
    });
    return wrap;
  }

  // ---- wiring ----
  btnVisual.addEventListener('click', () => setMode('visual'));
  btnText.addEventListener('click', () => setMode('text'));
  expandBtn.addEventListener('click', () => editor.querySelectorAll('details').forEach(d => { d.open = true; }));
  collapseBtn.addEventListener('click', () => editor.querySelectorAll('details').forEach(d => { d.open = false; }));
  fixBtn.addEventListener('click', () => { commit(); sync(true); });
  ta.addEventListener('input', () => { if (!internal) sync(false); });
  // Programmatic assignments (generation, presets, restored state) do not fire "input".
  Object.defineProperty(ta, 'value', {
    configurable: true,
    get() { return nativeValue.get.call(this); },
    set(v) { nativeValue.set.call(this, v); sync(true); }
  });
  sync(true);
})();
