/* Blissfest Pixel Tiles: editor UI. Geometry lives in geometry.js. */
(function () {
  'use strict';
  const G = window.PixelGeometry;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const STORE_KEY = 'blissfest-pixel-tiles-v1';
  const VIEW_CELL = 10; // editor units per cell

  const DEFAULT_STYLE = { radius: 0.18, innerRadius: 0, gap: 0.1, inset: 0 };
  const INK = '#231f20';
  const SWATCHES = [INK, '#ffffff', '#8a8582'];

  // Starter tiles taken from the "Tile patterns" sheet. X = fused pixels.
  const PRESETS = [
    { name: 'Checker frame', rows: ['X.XX.X', '.X..X.', 'X.XX.X', 'X.XX.X', '.X..X.', 'X.XX.X'] },
    { name: 'Window', rows: ['.X..X.', 'X.XX.X', '.X..X.', '.X..X.', 'X.XX.X', '.X..X.'] },
    { name: 'Cross', rows: ['X....X', '.X..X.', '..XX..', '..XX..', '.X..X.', 'X....X'] },
    { name: 'Stairs', rows: ['X.....', 'XX....', '.XX...', '..XX..', '...XX.', '....XX'] },
  ];

  /** Shape keys: "m|<colour>" fuses with touching same-colour pixels,
   *  "p<n>|<colour>" is a separate piece. */
  const colorOf = (key) => key.slice(key.indexOf('|') + 1);

  const state = {
    w: 6,
    h: 6,
    cells: new Array(36).fill(null),
    tool: 'draw',
    color: INK,
    mirrorX: false,
    mirrorY: false,
    showGrid: true,
    style: Object.assign({}, DEFAULT_STYLE),
    cellPx: 40,
    crop: false,
    bg: false,
    bgColor: '#ffffff',
    fileName: 'blissfest-tile',
    pieceCounter: 1,
    recent: [],
  };
  const undoStack = [];
  const redoStack = [];

  // ---------- persistence ----------
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(serialise()));
    } catch (e) { /* storage unavailable: fine */ }
  }
  function serialise() {
    return {
      version: 1,
      w: state.w, h: state.h, cells: state.cells,
      style: state.style, cellPx: state.cellPx, crop: state.crop,
      bg: state.bg, bgColor: state.bgColor, fileName: state.fileName,
      pieceCounter: state.pieceCounter, color: state.color, recent: state.recent,
      mirrorX: state.mirrorX, mirrorY: state.mirrorY, showGrid: state.showGrid,
    };
  }
  function restore(data) {
    if (!data || !Array.isArray(data.cells)) return false;
    const w = clampInt(data.w, 1, 64), h = clampInt(data.h, 1, 64);
    if (data.cells.length !== w * h) return false;
    state.w = w; state.h = h;
    state.cells = data.cells.map((c) => (typeof c === 'string' && c.includes('|') ? c : null));
    if (data.style) state.style = Object.assign({}, DEFAULT_STYLE, data.style);
    for (const k of ['cellPx', 'crop', 'bg', 'bgColor', 'fileName', 'color', 'mirrorX', 'mirrorY', 'showGrid']) {
      if (data[k] !== undefined) state[k] = data[k];
    }
    if (Array.isArray(data.recent)) state.recent = data.recent.slice(0, 8);
    state.pieceCounter = Math.max(data.pieceCounter || 1, maxPieceId() + 1);
    return true;
  }
  function maxPieceId() {
    let m = 0;
    for (const c of state.cells) {
      if (c && c[0] === 'p') m = Math.max(m, parseInt(c.slice(1), 10) || 0);
    }
    return m;
  }
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));

  // ---------- history ----------
  function snapshot() {
    return { w: state.w, h: state.h, cells: state.cells.slice() };
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  function applySnap(s) {
    state.w = s.w; state.h = s.h; state.cells = s.cells.slice();
    syncGridInputs();
    render();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    applySnap(undoStack.pop());
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    applySnap(redoStack.pop());
  }

  // ---------- editing ----------
  function mirrored(x, y) {
    const pts = [[x, y]];
    if (state.mirrorX) pts.push([state.w - 1 - x, y]);
    if (state.mirrorY) pts.push([x, state.h - 1 - y]);
    if (state.mirrorX && state.mirrorY) pts.push([state.w - 1 - x, state.h - 1 - y]);
    return pts;
  }

  let stroke = null; // { key, erase, last:[x,y], changed }

  function setCell(x, y, key) {
    if (x < 0 || y < 0 || x >= state.w || y >= state.h) return;
    const i = y * state.w + x;
    if (state.cells[i] !== key) {
      state.cells[i] = key;
      stroke.changed = true;
    }
  }

  function paintAt(x, y) {
    for (const [mx, my] of mirrored(x, y)) setCell(mx, my, stroke.erase ? null : stroke.key);
  }

  function paintLine(x0, y0, x1, y1) {
    // Bresenham so fast drags don't skip cells.
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      paintAt(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function beginStroke(x, y, erase) {
    pushUndo();
    let key = null;
    if (!erase) {
      if (state.tool === 'piece') {
        // Starting on an existing piece of the same colour grows that piece.
        const under = state.cells[y * state.w + x];
        key = under && under[0] === 'p' && colorOf(under) === state.color
          ? under
          : 'p' + state.pieceCounter++ + '|' + state.color;
      } else {
        key = 'm|' + state.color;
      }
      rememberColor(state.color);
    }
    stroke = { key, erase, last: [x, y], changed: false };
    paintAt(x, y);
    render();
  }

  function endStroke() {
    if (!stroke) return;
    if (!stroke.changed) undoStack.pop();
    stroke = null;
    save();
    updateButtons();
  }

  function resize(w, h) {
    w = clampInt(w, 1, 64); h = clampInt(h, 1, 64);
    if (w === state.w && h === state.h) return;
    pushUndo();
    const next = new Array(w * h).fill(null);
    for (let y = 0; y < Math.min(h, state.h); y++) {
      for (let x = 0; x < Math.min(w, state.w); x++) next[y * w + x] = state.cells[y * state.w + x];
    }
    state.w = w; state.h = h; state.cells = next;
    render(); save();
  }

  function loadPreset(p) {
    pushUndo();
    state.h = p.rows.length;
    state.w = p.rows[0].length;
    const key = 'm|' + state.color;
    state.cells = p.rows.join('').split('').map((c) => (c === 'X' ? key : null));
    syncGridInputs();
    render(); save();
  }

  // ---------- rendering ----------
  const editor = $('editor');
  let hoverCell = null;

  function el(name, attrs) {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function render() {
    const W = state.w * VIEW_CELL, H = state.h * VIEW_CELL;
    editor.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    editor.replaceChildren();
    editor.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: state.bg ? state.bgColor : '#ffffff' }));
    if (state.showGrid) {
      const g = el('g', {});
      for (let x = 0; x <= state.w; x++) g.appendChild(el('line', { class: 'gridline', x1: x * VIEW_CELL, y1: 0, x2: x * VIEW_CELL, y2: H }));
      for (let y = 0; y <= state.h; y++) g.appendChild(el('line', { class: 'gridline', x1: 0, y1: y * VIEW_CELL, x2: W, y2: y * VIEW_CELL }));
      editor.appendChild(g);
    }
    const grid = { width: state.w, height: state.h, cells: state.cells };
    for (const sh of G.buildShapes(grid, Object.assign({ cell: VIEW_CELL }, state.style), colorOf)) {
      if (sh.d) editor.appendChild(el('path', { d: sh.d, fill: sh.color }));
    }
    if (hoverCell) {
      editor.appendChild(el('rect', {
        class: 'hover', x: hoverCell[0] * VIEW_CELL, y: hoverCell[1] * VIEW_CELL, width: VIEW_CELL, height: VIEW_CELL,
      }));
    }
    renderPreview();
    updateButtons();
  }

  function exportSVG() {
    const grid = { width: state.w, height: state.h, cells: state.cells };
    return G.toSVG(grid, Object.assign({ cell: Number(state.cellPx) || 40 }, state.style), colorOf, {
      crop: state.crop,
      background: state.bg ? state.bgColor : null,
      title: state.fileName || 'Blissfest pixel asset',
    });
  }

  function renderPreview() {
    $('preview').innerHTML = exportSVG();
  }

  function updateButtons() {
    $('undo').disabled = !undoStack.length;
    $('redo').disabled = !redoStack.length;
  }

  function cellFromEvent(ev) {
    const pt = editor.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(editor.getScreenCTM().inverse());
    const x = Math.floor(p.x / VIEW_CELL), y = Math.floor(p.y / VIEW_CELL);
    if (x < 0 || y < 0 || x >= state.w || y >= state.h) return null;
    return [x, y];
  }

  // ---------- events ----------
  editor.addEventListener('contextmenu', (e) => e.preventDefault());
  editor.addEventListener('pointerdown', (ev) => {
    const c = cellFromEvent(ev);
    if (!c) return;
    editor.setPointerCapture(ev.pointerId);
    const erase = state.tool === 'erase' || ev.button === 2 || ev.altKey;
    beginStroke(c[0], c[1], erase);
  });
  editor.addEventListener('pointermove', (ev) => {
    const c = cellFromEvent(ev);
    if (stroke) {
      if (c && (c[0] !== stroke.last[0] || c[1] !== stroke.last[1])) {
        paintLine(stroke.last[0], stroke.last[1], c[0], c[1]);
        stroke.last = c;
        hoverCell = c;
        render();
      }
      return;
    }
    const changed = (c ? c.join() : '') !== (hoverCell ? hoverCell.join() : '');
    hoverCell = c;
    if (changed) render();
  });
  const stop = () => endStroke();
  editor.addEventListener('pointerup', stop);
  editor.addEventListener('pointercancel', stop);
  editor.addEventListener('pointerleave', () => {
    if (!stroke && hoverCell) { hoverCell = null; render(); }
  });

  const TOOL_HINTS = {
    draw: 'Touching pixels fuse into one shape.',
    piece: 'Each stroke is its own shape. Start on a piece to grow it.',
    erase: 'Click or drag to erase. Right-click erases with any tool.',
  };
  function setTool(t) {
    state.tool = t;
    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tool === t);
      b.setAttribute('aria-checked', b.dataset.tool === t);
    });
    $('toolHint').textContent = TOOL_HINTS[t];
  }
  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

  function rememberColor(c) {
    c = c.toLowerCase();
    if (SWATCHES.includes(c)) return;
    state.recent = [c].concat(state.recent.filter((r) => r !== c)).slice(0, 5);
    renderSwatches();
  }
  function renderSwatches() {
    const box = $('swatches');
    box.replaceChildren();
    for (const c of SWATCHES.concat(state.recent)) {
      const b = document.createElement('button');
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', 'Use colour ' + c);
      b.classList.toggle('on', c === state.color.toLowerCase());
      b.addEventListener('click', () => setColor(c));
      box.appendChild(b);
    }
  }
  function setColor(c) {
    state.color = c.toLowerCase();
    $('color').value = state.color;
    renderSwatches();
    save();
  }
  $('color').addEventListener('input', (e) => setColor(e.target.value));

  $('mirrorX').addEventListener('change', (e) => { state.mirrorX = e.target.checked; save(); });
  $('mirrorY').addEventListener('change', (e) => { state.mirrorY = e.target.checked; save(); });
  $('showGrid').addEventListener('change', (e) => { state.showGrid = e.target.checked; render(); save(); });

  function syncGridInputs() {
    $('gridW').value = state.w;
    $('gridH').value = state.h;
  }
  $('gridW').addEventListener('change', (e) => { resize(e.target.value, state.h); syncGridInputs(); });
  $('gridH').addEventListener('change', (e) => { resize(state.w, e.target.value); syncGridInputs(); });

  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('clear').addEventListener('click', () => {
    if (state.cells.every((c) => c == null)) return;
    pushUndo();
    state.cells = state.cells.map(() => null);
    render(); save();
  });
  $('invert').addEventListener('click', () => {
    pushUndo();
    const key = 'm|' + state.color;
    state.cells = state.cells.map((c) => (c == null ? key : null));
    render(); save();
  });

  // Style sliders
  const SLIDERS = { radius: 'radiusOut', innerRadius: 'innerOut', gap: 'gapOut', inset: 'insetOut' };
  function syncSliders() {
    for (const k in SLIDERS) {
      $(k).value = state.style[k];
      $(SLIDERS[k]).textContent = Math.round(state.style[k] * 100) + '% of pixel';
    }
  }
  for (const k in SLIDERS) {
    $(k).addEventListener('input', (e) => {
      state.style[k] = Number(e.target.value);
      $(SLIDERS[k]).textContent = Math.round(state.style[k] * 100) + '% of pixel';
      render(); save();
    });
  }
  $('resetStyle').addEventListener('click', () => {
    state.style = Object.assign({}, DEFAULT_STYLE);
    syncSliders(); render(); save();
  });

  // Export options
  $('cellPx').addEventListener('change', (e) => { state.cellPx = clampInt(e.target.value, 1, 1000); e.target.value = state.cellPx; renderPreview(); save(); });
  $('crop').addEventListener('change', (e) => { state.crop = e.target.checked; renderPreview(); save(); });
  $('bg').addEventListener('change', (e) => { state.bg = e.target.checked; render(); save(); });
  $('bgColor').addEventListener('input', (e) => { state.bgColor = e.target.value; render(); save(); });
  $('fileName').addEventListener('input', (e) => { state.fileName = e.target.value; save(); });

  function baseName() {
    return (state.fileName || 'blissfest-tile').trim().replace(/[^\w.-]+/g, '-') || 'blissfest-tile';
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function status(msg) {
    $('status').textContent = msg;
    clearTimeout(status.t);
    status.t = setTimeout(() => ($('status').textContent = ''), 3000);
  }

  $('dlSvg').addEventListener('click', () => {
    download(new Blob([exportSVG()], { type: 'image/svg+xml' }), baseName() + '.svg');
    status('SVG downloaded.');
  });
  $('copySvg').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(exportSVG());
      status('SVG copied. Paste it straight into Figma.');
    } catch (e) {
      status('Copy was blocked by the browser. Use Download instead.');
    }
  });
  $('dlPng').addEventListener('click', () => {
    const svg = exportSVG();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const scale = 2;
      const c = document.createElement('canvas');
      c.width = img.width * scale; c.height = img.height * scale;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => { download(b, baseName() + '@2x.png'); status('PNG downloaded.'); }, 'image/png');
    };
    img.src = url;
  });
  $('saveJson').addEventListener('click', () => {
    download(new Blob([JSON.stringify(serialise(), null, 2)], { type: 'application/json' }), baseName() + '.json');
    status('Grid saved.');
  });
  $('loadJson').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      pushUndo();
      if (!restore(JSON.parse(await f.text()))) throw new Error('bad file');
      syncAll(); render(); save();
      status('Grid opened.');
    } catch (err) {
      undoStack.pop();
      status('That file is not a saved grid.');
    }
  });

  // Starters
  function renderPresets() {
    const box = $('presets');
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.title = p.name;
      b.setAttribute('aria-label', 'Load starter: ' + p.name);
      const grid = { width: p.rows[0].length, height: p.rows.length, cells: p.rows.join('').split('').map((c) => (c === 'X' ? 'm|' + INK : null)) };
      b.innerHTML = G.toSVG(grid, Object.assign({ cell: 10 }, DEFAULT_STYLE), colorOf, { title: p.name });
      b.addEventListener('click', () => loadPreset(p));
      box.appendChild(b);
    }
  }

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type="text"], input[type="number"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod) return;
    const k = e.key.toLowerCase();
    if (k === 'b' || k === 'd') setTool('draw');
    else if (k === 'p') setTool('piece');
    else if (k === 'e') setTool('erase');
  });

  function syncAll() {
    syncGridInputs();
    syncSliders();
    $('color').value = state.color;
    $('mirrorX').checked = state.mirrorX;
    $('mirrorY').checked = state.mirrorY;
    $('showGrid').checked = state.showGrid;
    $('cellPx').value = state.cellPx;
    $('crop').checked = state.crop;
    $('bg').checked = state.bg;
    $('bgColor').value = state.bgColor;
    $('fileName').value = state.fileName;
    renderSwatches();
  }

  // ---------- boot ----------
  let restored = false;
  try {
    restored = restore(JSON.parse(localStorage.getItem(STORE_KEY)));
  } catch (e) { /* ignore */ }
  if (!restored) {
    const p = PRESETS[1];
    state.cells = p.rows.join('').split('').map((c) => (c === 'X' ? 'm|' + INK : null));
  }
  renderPresets();
  syncAll();
  setTool('draw');
  render();
})();
