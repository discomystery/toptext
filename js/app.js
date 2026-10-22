// Quick Meme: editor core (state changes, history, canvas interaction, import/export).
import {
  S, ui, assets, originals, mk, cloneCanvas, newId, IW, IH,
  TEXT_DEFAULTS, TEXT_STYLE_KEYS, BUILTIN_PRESETS, RATIOS, defaultCaption,
} from './state.js';
import {
  drawDoc, drawUI, captionLayout, bounds, centerOf, handlesFor, hitLayer, rotPt,
  textLayout, renderToCanvas, adjustedBase, invalidateAdjust, clearTextCache,
} from './render.js';
import { $, toast } from './dom.js';
import { injectGoogleFonts, loadSavedFonts, ensureFont } from './fonts.js';
import * as store from './store.js';
import { renderPanel, renderLayers, updateLive, renderEmptyTemplates } from './panels.js';

const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const stage = $('#stage');
const HAS_FILTER = 'filter' in CanvasRenderingContext2D.prototype;

// ======================================================================
// Rendering
// ======================================================================
let rafPending = false;
export function render() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; draw(); });
}

function draw() {
  if (!S.base) return;
  const cap = captionLayout();
  ui.capH = cap.h;
  const W = S.base.width, H = S.base.height + cap.h;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; fitCanvas(); }
  drawDoc(ctx, cap);
  drawUI(ctx, cap, selected());
  updateLive();
}

function fitCanvas() {
  if (!S.base || !canvas.width) return;
  const r = stage.getBoundingClientRect();
  const pad = r.width < 500 ? 12 : 36;
  const s = Math.max(0.01, Math.min((r.width - pad * 2) / canvas.width, (r.height - pad * 2) / canvas.height, 2));
  canvas.style.width = canvas.width * s + 'px';
  canvas.style.height = canvas.height * s + 'px';
  ui.uiS = 1 / s;
}
new ResizeObserver(() => { fitCanvas(); render(); }).observe(stage);

// ======================================================================
// History (undo / redo)
// ======================================================================
let undoStack = [], redoStack = [], commitTimer = null;

const signature = s => JSON.stringify([s.bgFill, s.adj, s.caption, s.layers]);
function snapshot() {
  const s = { base: S.base, bgFill: S.bgFill, adj: { ...S.adj }, caption: { ...S.caption }, layers: structuredClone(S.layers) };
  s.sig = signature(s);
  return s;
}

export function commit() {
  clearTimeout(commitTimer); commitTimer = null;
  if (!S.base) return;
  const s = snapshot();
  const last = undoStack[undoStack.length - 1];
  const sel = selected();
  if (sel?.type === 'text') ui.lastTextStyle = pickStyle(sel);
  if (last && last.base === s.base && last.sig === s.sig) return;
  undoStack.push(s);
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  updateButtons();
  renderLayers();
}
export function scheduleCommit() { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 400); }
export function flush() { if (commitTimer) commit(); }
/** Call after mutating state from a control: redraw now, save an undo step shortly. */
export function changed() { render(); scheduleCommit(); }

function restore(s) {
  S.base = s.base; S.bgFill = s.bgFill;
  S.adj = { ...s.adj }; S.caption = { ...s.caption };
  S.layers = structuredClone(s.layers);
  if (!layerById(ui.selectedId)) ui.selectedId = null;
  ui.crop = null; ui.brush = null;
  if (ui.mode === 'crop') ui.mode = 'home';
  renderPanel(); renderLayers(); updateButtons(); render();
}
export function undo() { flush(); if (undoStack.length < 2) return; redoStack.push(undoStack.pop()); restore(undoStack[undoStack.length - 1]); }
export function redo() { flush(); const s = redoStack.pop(); if (!s) return; undoStack.push(s); restore(s); }

function updateButtons() {
  $('#btnUndo').disabled = undoStack.length < 2;
  $('#btnRedo').disabled = !redoStack.length;
  $('#btnCopy').disabled = $('#btnDownload').disabled = !S.base;
}

// ======================================================================
// Selection & modes
// ======================================================================
export const layerById = id => id ? S.layers.find(l => l.id === id) : undefined;
export const selected = () => layerById(ui.selectedId);

export function select(id) {
  flush();
  ui.selectedId = id;
  if (id && ui.crop) { ui.crop = null; ui.mode = 'home'; }
  if (id && ui.brush && ui.brush.target !== id) ui.brush = null;
  renderPanel(); renderLayers(); render();
}

export function setMode(m) {
  flush();
  ui.brush = null; ui.brushPos = null;
  if (m !== 'crop') ui.crop = null;
  ui.mode = m;
  ui.selectedId = null;
  if (m === 'crop' && S.base) startCrop();
  if (m === 'caption' && S.base && !S.caption.on) { S.caption.on = true; commit(); }
  renderPanel(); renderLayers(); render();
  if (m === 'caption') requestAnimationFrame(() => $('#captionText')?.focus());
}

export function focusText() {
  requestAnimationFrame(() => { const t = $('#layerText'); if (t) { t.focus(); t.select(); } });
}

// ======================================================================
// Layers
// ======================================================================
const pickStyle = l => Object.fromEntries(TEXT_STYLE_KEYS.map(k => [k, l[k]]));

function addLayer(l, { focus = false } = {}) {
  Object.assign(l, { id: newId(), visible: true, locked: false, opacity: l.opacity ?? 1, rot: l.rot ?? 0 });
  S.layers.push(l);
  ui.crop = null; ui.brush = null;
  if (ui.mode === 'crop') ui.mode = 'home';
  ui.selectedId = l.id;
  commit(); renderPanel(); renderLayers(); render();
  if (focus) focusText();
  return l;
}

function textSize() { return Math.max(12, Math.round(Math.min(IW(), IH() * 1.4) / 12)); }

export function addText(text = 'Your text') {
  const style = { ...TEXT_DEFAULTS, ...(ui.lastTextStyle || BUILTIN_PRESETS[2].style) };
  const l = { type: 'text', text, ...style, size: textSize(), x: IW() * 0.08, w: IW() * 0.84, y: 0 };
  l.y = IH() / 2 - textLayout(l).h / 2;
  ensureFont(l.font, l.weight, l.italic).then(() => { clearTextCache(); render(); });
  return addLayer(l, { focus: true });
}

export function addMemeText() {
  const style = { ...TEXT_DEFAULTS, ...BUILTIN_PRESETS[0].style };
  const size = Math.max(14, Math.round(Math.min(IW(), IH() * 1.2) / 10));
  const make = (text, top) => {
    const l = { type: 'text', text, ...style, size, x: IW() * 0.04, w: IW() * 0.92, y: 0, id: newId(), visible: true, locked: false, opacity: 1, rot: 0 };
    l.y = top ? IH() * 0.03 : IH() - textLayout(l).h - IH() * 0.03;
    return l;
  };
  const top = make('Top text', true), bottom = make('Bottom text', false);
  S.layers.push(top, bottom);
  ui.crop = null; ui.brush = null; if (ui.mode === 'crop') ui.mode = 'home';
  ui.selectedId = top.id;
  commit(); renderPanel(); renderLayers(); render();
  focusText();
}

export function addEmoji(char) {
  const s = Math.round(Math.min(IW(), IH()) * 0.2);
  const n = S.layers.filter(l => l.type === 'emoji').length % 5;
  addLayer({ type: 'emoji', char, w: s, h: s, x: IW() / 2 - s / 2 + n * s * 0.3, y: IH() / 2 - s / 2 + n * s * 0.3 });
}

const strokeDefault = () => Math.max(4, Math.round(Math.max(IW(), IH()) / 170));
export function addShape(type) {
  const w = IW() * 0.4, h = IH() * 0.3;
  addLayer({ type, x: (IW() - w) / 2, y: (IH() - h) / 2, w, h, stroke: '#ff2d2d', strokeW: strokeDefault(), fillOn: false, fill: '#ffd60a', radius: 0 });
}
export function addArrow() {
  const sw = Math.max(6, Math.round(Math.max(IW(), IH()) / 110));
  addLayer({ type: 'arrow', x1: IW() * 0.3, y1: IH() * 0.7, x2: IW() * 0.56, y2: IH() * 0.42, color: '#ff2d2d', strokeW: sw, outline: true, outlineColor: '#ffffff' });
}
export function addBlur() {
  const w = IW() * 0.35, h = IH() * 0.15;
  addLayer({ type: 'blur', x: (IW() - w) / 2, y: (IH() - h) / 2, w, h, mode: 'blur', strength: 4, color: '#000000' });
}
export function addImageLayer(c, name) {
  const id = newId('a');
  assets.set(id, c);
  let w = IW() * 0.5, h = w * c.height / c.width;
  if (h > IH() * 0.8) { h = IH() * 0.8; w = h * c.width / c.height; }
  return addLayer({ type: 'image', src: id, name, x: (IW() - w) / 2, y: (IH() - h) / 2, w, h });
}

export function deleteLayer(id = ui.selectedId) {
  const i = S.layers.findIndex(l => l.id === id);
  if (i < 0) return;
  S.layers.splice(i, 1);
  if (ui.selectedId === id) ui.selectedId = null;
  if (ui.brush?.target === id) ui.brush = null;
  commit(); renderPanel(); renderLayers(); render();
}

export function duplicateLayer(id = ui.selectedId) {
  const i = S.layers.findIndex(l => l.id === id);
  if (i < 0) return;
  const c = structuredClone(S.layers[i]);
  c.id = newId(); c.locked = false;
  if (c.name) c.name += ' copy';
  const d = Math.round(Math.min(IW(), IH()) * 0.04);
  if (c.type === 'arrow') { c.x1 += d; c.y1 += d; c.x2 += d; c.y2 += d; } else { c.x += d; c.y += d; }
  S.layers.splice(i + 1, 0, c);
  ui.selectedId = c.id;
  commit(); renderPanel(); renderLayers(); render();
}

/** dir: +1 = forward (up), -1 = backward (down) */
export function moveZ(id, dir) {
  const i = S.layers.findIndex(l => l.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= S.layers.length) return;
  [S.layers[i], S.layers[j]] = [S.layers[j], S.layers[i]];
  commit(); renderLayers(); render();
}
export function reorder(id, toIndex) {
  const i = S.layers.findIndex(l => l.id === id);
  if (i < 0) return;
  const [l] = S.layers.splice(i, 1);
  S.layers.splice(Math.max(0, Math.min(S.layers.length, toIndex)), 0, l);
  commit(); renderLayers(); render();
}

/** Change a text layer while keeping it visually anchored (bottom text grows upward). */
export function mutateText(l, fn) {
  const b0 = bounds(l);
  fn();
  const b1 = bounds(l);
  if (b0.y + b0.h / 2 > IH() / 2) l.y = b0.y + b0.h - b1.h;
}

export function applyStyle(l, style) {
  mutateText(l, () => Object.assign(l, TEXT_DEFAULTS, { align: l.align }, style));
  ensureFont(l.font, l.weight, l.italic).then(() => { clearTextCache(); render(); });
  ui.lastTextStyle = pickStyle(l);
  commit(); renderPanel(); render();
}

// ---- User presets ----
export let userPresets = [];
export async function savePreset(name, l) {
  userPresets = [...userPresets, { id: newId('p'), name, style: pickStyle(l) }];
  await store.set('presets', userPresets);
  renderPanel();
  toast(`Saved style "${name}"`);
}
export async function deletePreset(id) {
  userPresets = userPresets.filter(p => p.id !== id);
  await store.set('presets', userPresets);
  renderPanel();
}

// ======================================================================
// Base image: open, crop, pad, rotate
// ======================================================================
export function openAsBase(c) {
  S.base = c;
  S.bgFill = null;
  S.adj = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
  S.caption = { ...defaultCaption(), size: Math.max(16, Math.round(c.width / 18)) };
  S.layers = [];
  Object.assign(ui, { selectedId: null, mode: 'home', crop: null, brush: null, cropRatio: 0 });
  undoStack = []; redoStack = [];
  document.body.classList.remove('no-image');
  $('#empty').hidden = true;
  canvas.hidden = false;
  canvas.width = 0;
  commit(); updateButtons(); renderPanel(); renderLayers(); render();
}

export function blankCanvas(w, h, color = '#ffffff') {
  const c = mk(w, h), g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  return c;
}

function toCanvas(src, w, h) {
  const MAX = 5000;
  const s = Math.min(1, MAX / Math.max(w, h));
  const c = mk(w * s, h * s), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
export async function fileToCanvas(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const c = toCanvas(bmp, bmp.width, bmp.height);
    bmp.close();
    return c;
  } catch {
    const url = URL.createObjectURL(blob);
    try { return await urlToCanvas(url); } finally { URL.revokeObjectURL(url); }
  }
}
export function urlToCanvas(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(toCanvas(img, img.naturalWidth, img.naturalHeight));
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

const hasEdits = () => undoStack.length > 1;
function confirmDiscard() {
  return !hasEdits() || confirm('Start over with a new image? Your current edits will be lost (download first if you need them).');
}

async function handleIncoming(file, { replace = false } = {}) {
  if (!file || !file.type.startsWith('image/')) { toast("That doesn't look like an image."); return; }
  let c;
  try { c = await fileToCanvas(file); } catch { toast("Couldn't read that image. Try a PNG or JPG."); return; }
  if (!S.base) openAsBase(c);
  else if (replace) { if (confirmDiscard()) openAsBase(c); }
  else {
    addImageLayer(c, (file.name || '').replace(/\.[^.]+$/, '') || 'Pasted image');
    toast('Added as a new layer. (Use Open to start over with a new image.)', 3500);
  }
}

function shiftLayers(dx, dy) {
  for (const l of S.layers) {
    if (l.type === 'arrow') { l.x1 += dx; l.y1 += dy; l.x2 += dx; l.y2 += dy; }
    else { l.x += dx; l.y += dy; }
  }
}

function startCrop() {
  ui.crop = { x: 0, y: 0, w: IW(), h: IH(), ratio: null };
  if (RATIOS[ui.cropRatio]?.r) setCropRatio(ui.cropRatio);
}

export function setCropRatio(i) {
  ui.cropRatio = i;
  if (!ui.crop) ui.crop = { x: 0, y: 0, w: IW(), h: IH() };
  let r = RATIOS[i].r;
  if (r === 'orig') r = IW() / IH();
  ui.crop.ratio = r;
  if (r) {
    let w = IW(), h = w / r;
    if (h > IH()) { h = IH(); w = h * r; }
    Object.assign(ui.crop, { x: (IW() - w) / 2, y: (IH() - h) / 2, w, h });
  }
  render();
}

export function applyCrop() {
  const k = ui.crop;
  if (!k) return;
  const x = Math.round(k.x), y = Math.round(k.y), w = Math.round(k.w), h = Math.round(k.h);
  if (x === 0 && y === 0 && w === IW() && h === IH()) { toast('Pick a size or drag the corners first.'); return; }
  const c = mk(w, h);
  c.getContext('2d').drawImage(S.base, -x, -y);
  S.base = c;
  shiftLayers(-x, -y);
  ui.crop = null; ui.mode = 'home';
  commit(); renderPanel(); render();
  toast(`Cropped to ${w} × ${h}px`);
}

/** Extend the canvas to ratio r instead of cropping. fill: 'blur' | 'transparent' | a colour. */
export function padTo(r, fill) {
  const src = adjustedBase();
  const W = src.width, H = src.height;
  let nw = W, nh = H;
  if (W / H < r) nw = Math.round(H * r); else nh = Math.round(W / r);
  if (Math.abs(nw - W) < 2 && Math.abs(nh - H) < 2) { toast('The image is already that shape.'); return; }
  const c = mk(nw, nh), g = c.getContext('2d');
  if (fill === 'blur') {
    const s = Math.max(nw / W, nh / H) * 1.1;
    // Heavy blur on purpose: the fill must never make small text (e.g. a hidden name) readable.
    const k = 48;
    const small = mk(nw / k, nh / k), sg = small.getContext('2d');
    sg.drawImage(src, (small.width - W * s / k) / 2, (small.height - H * s / k) / 2, W * s / k, H * s / k);
    g.imageSmoothingQuality = 'high';
    const br = Math.round(Math.max(nw, nh) / 60);
    if (HAS_FILTER) g.filter = `blur(${br}px)`;
    // Overdraw past the edges so the blur doesn't fade to transparent at the borders.
    g.drawImage(small, -br * 3, -br * 3, nw + br * 6, nh + br * 6);
    g.filter = 'none';
    g.fillStyle = 'rgba(0,0,0,.15)';
    g.fillRect(0, 0, nw, nh);
  } else if (fill !== 'transparent') {
    g.fillStyle = fill; g.fillRect(0, 0, nw, nh);
  }
  const ox = Math.round((nw - W) / 2), oy = Math.round((nh - H) / 2);
  g.drawImage(src, ox, oy);
  S.base = c;
  S.adj = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 }; // baked into the new image
  shiftLayers(ox, oy);
  ui.crop = null; ui.mode = 'home';
  commit(); renderPanel(); render();
  toast(`Resized canvas to ${nw} × ${nh}px`);
}

/** kind: 'cw' | 'ccw' | 'h' | 'v' */
export function transformBase(kind) {
  const W = IW(), H = IH();
  const turn = kind === 'cw' || kind === 'ccw';
  const c = mk(turn ? H : W, turn ? W : H), g = c.getContext('2d');
  if (kind === 'cw') { g.translate(H, 0); g.rotate(Math.PI / 2); }
  if (kind === 'ccw') { g.translate(0, W); g.rotate(-Math.PI / 2); }
  if (kind === 'h') { g.translate(W, 0); g.scale(-1, 1); }
  if (kind === 'v') { g.translate(0, H); g.scale(1, -1); }
  g.drawImage(S.base, 0, 0);
  const f = { cw: (x, y) => [H - y, x], ccw: (x, y) => [y, W - x], h: (x, y) => [W - x, y], v: (x, y) => [x, H - y] }[kind];
  for (const l of S.layers) {
    if (l.type === 'arrow') { [l.x1, l.y1] = f(l.x1, l.y1); [l.x2, l.y2] = f(l.x2, l.y2); continue; }
    const b = bounds(l);
    const [cx, cy] = f(b.x + b.w / 2, b.y + b.h / 2);
    let w = b.w, h = b.h;
    if (turn && (l.type === 'rect' || l.type === 'ellipse' || l.type === 'blur')) { [w, h] = [h, w]; l.w = w; l.h = h; }
    if (!turn && l.rot) l.rot = -l.rot;
    l.x = cx - w / 2; l.y = cy - h / 2;
  }
  S.base = c;
  ui.crop = null;
  if (ui.mode === 'crop') startCrop();
  commit(); render();
}

export function setBgFill(color) { S.bgFill = color; changed(); }

// ======================================================================
// Background removal + touch-up brush
// ======================================================================
function imageTarget(target) {
  if (target === 'base') return { isBase: true, get: () => S.base, set: c => { S.base = c; invalidateAdjust(); } };
  const l = layerById(target);
  if (!l) return null;
  return {
    layer: l,
    get: () => assets.get(l.src),
    set: c => { const id = newId('a'); assets.set(id, c); l.src = id; },
  };
}

function setBusy(on, msg, p) {
  ui.busy = on;
  $('#busy').hidden = !on;
  if (msg) $('#busyText').textContent = msg;
  $('#busyBar').style.width = Math.round((p ?? 0) * 100) + '%';
}

export async function removeBg(target) {
  const t = imageTarget(target);
  if (!t || ui.busy) return;
  flush();
  const src = t.get();
  setBusy(true, 'Loading background remover…', 0);
  try {
    const { removeBackground } = await import('./bgremove.js');
    const out = await removeBackground(src, (p, msg) => setBusy(true, msg, p));
    originals.set(out, originals.get(src) || src);
    t.set(out);
    commit(); renderPanel(); render();
    toast('Background removed. Use Touch up to fix any edges.', 3500);
  } catch (e) {
    console.error(e);
    toast('Background removal failed: ' + (e?.message || e), 5000);
  } finally {
    setBusy(false);
  }
}

export function startBrush(target) {
  flush();
  ui.crop = null;
  ui.brush = { target, mode: 'erase', size: ui.brush?.size || 40 };
  ui.selectedId = target === 'base' ? null : target;
  if (target === 'base') ui.mode = 'image';
  renderPanel(); renderLayers(); render();
}
export function stopBrush() {
  ui.brush = null; ui.brushPos = null;
  canvas.style.cursor = 'default';
  renderPanel(); render();
}

function brushLocal(t, p) {
  if (t.isBase) return p;
  const l = t.layer, a = assets.get(l.src);
  const q = rotPt(p, centerOf(l), -(l.rot || 0));
  let x = (q.x - l.x) * a.width / l.w;
  if (l.flipX) x = a.width - x;
  return { x, y: (q.y - l.y) * a.height / l.h };
}

function paintSeg(d, a, b) {
  const g = d.work.getContext('2d');
  const r = ui.brush.size * ui.uiS * d.scale / 2;
  g.save();
  if (ui.brush.mode === 'erase') {
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = 'round'; g.lineWidth = r * 2;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x + 0.01, b.y); g.stroke();
  } else {
    g.beginPath();
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r / 3)));
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * i / steps, y = a.y + (b.y - a.y) * i / steps;
      g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2);
    }
    g.clip();
    g.clearRect(0, 0, d.work.width, d.work.height);
    g.drawImage(d.orig, 0, 0, d.work.width, d.work.height);
  }
  g.restore();
}

// ======================================================================
// Canvas pointer interaction
// ======================================================================
let drag = null;

function toImg(e) {
  const r = canvas.getBoundingClientRect();
  const k = canvas.width / r.width;
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k - (ui.capH || 0) };
}

function handleAt(l, p) {
  let best = null, bd = 12 * ui.uiS;
  for (const hd of handlesFor(l)) {
    const d = Math.hypot(p.x - hd.x, p.y - hd.y);
    if (d < bd) { bd = d; best = hd; }
  }
  return best;
}

function hitTest(p) {
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const l = S.layers[i];
    if (l.visible === false || l.locked) continue;
    if (hitLayer(l, p, 4 * ui.uiS)) return l;
  }
  return null;
}

function cropHit(p) {
  const k = ui.crop, t = 16 * ui.uiS;
  const corners = { nw: [k.x, k.y], ne: [k.x + k.w, k.y], sw: [k.x, k.y + k.h], se: [k.x + k.w, k.y + k.h] };
  for (const [id, [x, y]] of Object.entries(corners)) if (Math.hypot(p.x - x, p.y - y) < t) return { kind: 'crop-handle', h: id };
  if (p.x > k.x && p.x < k.x + k.w && p.y > k.y && p.y < k.y + k.h) return { kind: 'crop-move' };
  return null;
}

const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab', p1: 'crosshair', p2: 'crosshair' };
function updateCursor(p) {
  if (ui.brush) { canvas.style.cursor = 'none'; return; }
  let cur = 'default';
  if (ui.crop) {
    const hit = cropHit(p);
    if (hit) cur = hit.kind === 'crop-move' ? 'move' : CURSORS[hit.h];
  } else {
    const sel = selected();
    const hd = sel && !sel.locked && handleAt(sel, p);
    if (hd) cur = CURSORS[hd.id];
    else if (hitTest(p)) cur = 'move';
  }
  canvas.style.cursor = cur;
}

function moveLayer(l, o, dx, dy, free) {
  ui.guides = null;
  if (!free) {
    const b = bounds(o), t = 7 * ui.uiS, g = {};
    const cx = b.x + b.w / 2 + dx, cy = b.y + b.h / 2 + dy;
    if (Math.abs(cx - IW() / 2) < t) { dx += IW() / 2 - cx; g.x = IW() / 2; }
    if (Math.abs(cy - IH() / 2) < t) { dy += IH() / 2 - cy; g.y = IH() / 2; }
    if (g.x != null || g.y != null) ui.guides = g;
  }
  if (l.type === 'arrow') { l.x1 = o.x1 + dx; l.y1 = o.y1 + dy; l.x2 = o.x2 + dx; l.y2 = o.y2 + dy; }
  else { l.x = o.x + dx; l.y = o.y + dy; }
}

function rotateLayer(l, o, p, shift) {
  const c = centerOf(o);
  let a = Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI + 90;
  if (shift) a = Math.round(a / 15) * 15;
  else { const n = Math.round(a / 90) * 90; if (Math.abs(a - n) < 4) a = n; }
  a = ((a + 180) % 360 + 360) % 360 - 180;
  l.rot = Math.round(a * 10) / 10;
}

function resizeLayer(l, o, hid, p, e) {
  if (o.type === 'arrow') {
    const fixed = hid === 'p1' ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
    let q = p;
    if (e.shiftKey) {
      const ang = Math.round(Math.atan2(p.y - fixed.y, p.x - fixed.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(p.x - fixed.x, p.y - fixed.y);
      q = { x: fixed.x + Math.cos(ang) * len, y: fixed.y + Math.sin(ang) * len };
    }
    if (hid === 'p1') { l.x1 = q.x; l.y1 = q.y; } else { l.x2 = q.x; l.y2 = q.y; }
    return;
  }
  const MIN = 10 * ui.uiS;
  const b = bounds(o), c0 = { x: b.x + b.w / 2, y: b.y + b.h / 2 }, rot = o.rot || 0;
  const q = rotPt(p, c0, -rot);
  const pl = { x: q.x - c0.x, y: q.y - c0.y };
  const sx = hid.includes('e') ? 1 : hid.includes('w') ? -1 : 0;
  const sy = hid.includes('s') ? 1 : hid.includes('n') ? -1 : 0;
  const fx = -sx * b.w / 2, fy = -sy * b.h / 2;
  let nw = sx ? Math.max(MIN, sx * (pl.x - fx)) : b.w;
  let nh = sy ? Math.max(MIN, sy * (pl.y - fy)) : b.h;

  if (o.type === 'text') {
    if (sx && sy) {
      // Corner: scale the whole text block.
      const s = nw / o.w;
      l.size = Math.max(4, o.size * s);
      l.w = nw;
    } else l.w = nw;
    nh = textLayout(l).h;
  } else {
    const keep = (o.type === 'emoji' || (o.type === 'image' && !e.shiftKey)) && sx && sy;
    if (keep) { const r = b.w / b.h; if (nw / nh > r) nh = nw / r; else nw = nh * r; }
    l.w = nw; l.h = nh;
  }
  const clx = sx ? fx + sx * nw / 2 : 0;
  const cly = sy ? fy + sy * nh / 2 : 0;
  const cw = rotPt({ x: c0.x + clx, y: c0.y + cly }, c0, rot);
  l.x = cw.x - nw / 2;
  l.y = cw.y - nh / 2;
}

function dragCrop(p) {
  const k = ui.crop, o = drag.orig;
  if (drag.kind === 'crop-move') {
    k.x = Math.max(0, Math.min(IW() - o.w, o.x + p.x - drag.start.x));
    k.y = Math.max(0, Math.min(IH() - o.h, o.y + p.y - drag.start.y));
    return;
  }
  const hid = drag.h, r = o.ratio;
  const sx = hid.includes('e') ? 1 : -1, sy = hid.includes('s') ? 1 : -1;
  const fx = sx > 0 ? o.x : o.x + o.w, fy = sy > 0 ? o.y : o.y + o.h;
  let w = Math.max(0, sx * (p.x - fx)), h = Math.max(0, sy * (p.y - fy));
  if (r) { if (w / (h || 1) > r) h = w / r; else w = h * r; }
  const maxW = sx > 0 ? IW() - fx : fx, maxH = sy > 0 ? IH() - fy : fy;
  if (w > maxW) { w = maxW; if (r) h = w / r; }
  if (h > maxH) { h = maxH; if (r) w = h * r; }
  const min = 24 * ui.uiS;
  if (w < min) { w = min; if (r) h = w / r; }
  if (h < min) { h = min; if (r) w = h * r; }
  Object.assign(k, { x: sx > 0 ? fx : fx - w, y: sy > 0 ? fy : fy - h, w, h });
}

canvas.addEventListener('pointerdown', e => {
  if (!S.base || ui.busy || e.button > 0) return;
  e.preventDefault();
  const p = toImg(e);
  canvas.setPointerCapture(e.pointerId);

  if (ui.brush) {
    const t = imageTarget(ui.brush.target);
    if (!t) return;
    const cur = t.get();
    const work = cloneCanvas(cur);
    const orig = originals.get(cur) || cur;
    originals.set(work, orig);
    t.set(work);
    const scale = t.isBase ? 1 : work.width / t.layer.w;
    drag = { kind: 'brush', t, work, orig, scale, last: brushLocal(t, p) };
    paintSeg(drag, drag.last, drag.last);
    render();
    return;
  }
  if (ui.crop) {
    const hit = cropHit(p);
    if (hit) drag = { ...hit, start: p, orig: { ...ui.crop } };
    return;
  }
  const sel = selected();
  if (sel && !sel.locked) {
    const hd = handleAt(sel, p);
    if (hd) { drag = { kind: 'handle', h: hd.id, id: sel.id, start: p, orig: structuredClone(sel) }; return; }
  }
  const hit = hitTest(p);
  if (hit) {
    if (hit.id !== ui.selectedId) select(hit.id);
    drag = { kind: 'move', id: hit.id, start: p, orig: structuredClone(hit) };
  } else if (p.y < 0 && S.caption.on) {
    setMode('caption');
  } else if (ui.selectedId) {
    select(null);
  }
});

canvas.addEventListener('pointermove', e => {
  if (!S.base) return;
  const p = toImg(e);
  if (ui.brush) {
    ui.brushPos = p;
    canvas.style.cursor = 'none';
    if (drag?.kind === 'brush') {
      const q = brushLocal(drag.t, p);
      paintSeg(drag, drag.last, q);
      drag.last = q;
      if (drag.t.isBase) invalidateAdjust();
    }
    render();
    return;
  }
  if (!drag) { updateCursor(p); return; }
  drag.changed = true;
  if (drag.kind.startsWith('crop')) { dragCrop(p); render(); return; }
  const l = layerById(drag.id);
  if (!l) return;
  if (drag.kind === 'move') moveLayer(l, drag.orig, p.x - drag.start.x, p.y - drag.start.y, e.altKey);
  else if (drag.h === 'rot') rotateLayer(l, drag.orig, p, e.shiftKey);
  else resizeLayer(l, drag.orig, drag.h, p, e);
  render();
});

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  ui.guides = null;
  if (d.kind === 'brush') commit();
  else if (d.changed && !d.kind.startsWith('crop')) {
    commit();
    if (d.kind === 'handle') renderPanel();
  }
  render();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { if (ui.brush) { ui.brushPos = null; render(); } });
canvas.addEventListener('dblclick', e => {
  const l = hitTest(toImg(e));
  if (l?.type === 'text') { select(l.id); focusText(); }
});
stage.addEventListener('pointerdown', e => {
  if (e.target === stage && S.base && !ui.crop && !ui.brush && ui.selectedId) select(null);
});

// ======================================================================
// Export
// ======================================================================
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

export async function download() {
  if (!S.base) return;
  flush();
  const blob = await new Promise(r => renderToCanvas().toBlob(r, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `quickmeme-${stamp()}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Downloaded PNG');
}

export async function copyImage() {
  if (!S.base) return;
  flush();
  try {
    const blob = new Promise(r => renderToCanvas().toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied! Paste it anywhere.');
  } catch (e) {
    console.warn(e);
    toast("Couldn't copy in this browser. Use Download instead.");
  }
}

// ======================================================================
// Templates
// ======================================================================
export const getTemplates = () => store.get('templates', []);

export async function saveTemplate(name, includeBase) {
  flush();
  const used = new Set(S.layers.filter(l => l.type === 'image').map(l => l.src));
  const assetData = {};
  for (const id of used) if (assets.get(id)) assetData[id] = assets.get(id).toDataURL('image/png');
  const t = {
    id: newId('t'), name, created: Date.now(), tw: IW(), th: IH(),
    layers: structuredClone(S.layers), caption: { ...S.caption }, adj: { ...S.adj }, bgFill: S.bgFill,
    assets: assetData, base: includeBase ? S.base.toDataURL('image/png') : null,
    thumb: renderToCanvas(320).toDataURL('image/png'),
  };
  const list = await getTemplates();
  const ok = await store.set('templates', [t, ...list]);
  toast(ok ? `Saved template "${name}"` : 'Could not save the template (browser storage may be full).');
  renderEmptyTemplates();
  return ok;
}

export async function deleteTemplate(id) {
  const list = await getTemplates();
  await store.set('templates', list.filter(t => t.id !== id));
  renderEmptyTemplates();
}

export async function applyTemplate(t, { fit = true } = {}) {
  flush();
  if (t.base) openAsBase(await urlToCanvas(t.base));
  else if (!S.base) openAsBase(blankCanvas(t.tw, t.th));
  else if (fit) {
    const r = t.tw / t.th;
    if (Math.abs(IW() / IH() - r) / r > 0.01) {
      let w = IW(), h = w / r;
      if (h > IH()) { h = IH(); w = h * r; }
      const c = mk(w, h);
      c.getContext('2d').drawImage(S.base, -Math.round((IW() - w) / 2), -Math.round((IH() - h) / 2));
      S.base = c;
    }
  }
  const sx = IW() / t.tw, sy = IH() / t.th, s = Math.min(sx, sy);
  const idMap = {};
  for (const [id, url] of Object.entries(t.assets || {})) {
    const nid = newId('a');
    assets.set(nid, await urlToCanvas(url));
    idMap[id] = nid;
  }
  S.layers = structuredClone(t.layers).map(l => {
    l.id = newId();
    if (l.type === 'image') l.src = idMap[l.src];
    if (l.type === 'arrow') {
      l.x1 *= sx; l.y1 *= sy; l.x2 *= sx; l.y2 *= sy; l.strokeW *= s;
      return l;
    }
    const b = bounds(l);
    const cx = (b.x + b.w / 2) * sx, cy = (b.y + b.h / 2) * sy;
    if (l.type === 'text') { l.size *= s; l.w *= sx; }
    else if (l.type === 'rect' || l.type === 'ellipse' || l.type === 'blur') { l.w *= sx; l.h *= sy; if (l.strokeW) l.strokeW *= s; }
    else { l.w *= s; l.h *= s; }
    const nb = bounds(l);
    l.x = cx - nb.w / 2; l.y = cy - nb.h / 2;
    return l;
  }).filter(l => l.type !== 'image' || l.src);
  S.caption = { ...t.caption, size: t.caption.size * s };
  S.adj = { ...t.adj };
  S.bgFill = t.bgFill;
  Object.assign(ui, { selectedId: null, mode: 'home', crop: null, brush: null });
  commit(); renderPanel(); renderLayers(); render();
  const fonts = S.layers.filter(l => l.type === 'text').map(l => ensureFont(l.font, l.weight, l.italic));
  Promise.all(fonts).then(() => { clearTextCache(); render(); });
  toast(`Applied "${t.name}". Edit the text to make it yours.`);
}

export async function exportBackup() {
  const data = { app: 'quick-meme', version: 1, exported: new Date().toISOString(), templates: await getTemplates(), presets: userPresets };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `quickmeme-templates-${stamp()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'quick-meme') throw new Error('Not a Quick Meme backup file');
    const list = await getTemplates();
    const have = new Set(list.map(t => t.id));
    const added = (data.templates || []).filter(t => !have.has(t.id));
    await store.set('templates', [...added, ...list]);
    const havePresets = new Set(userPresets.map(p => p.id));
    userPresets = [...userPresets, ...(data.presets || []).filter(p => !havePresets.has(p.id))];
    await store.set('presets', userPresets);
    toast(`Imported ${added.length} template${added.length === 1 ? '' : 's'}`);
    renderPanel(); renderEmptyTemplates();
  } catch (e) {
    toast("Couldn't import: " + e.message);
  }
}
export const importTemplates = () => $('#templateInput').click();

// ======================================================================
// Toolbar, keyboard, paste, drop
// ======================================================================
const TOOLS = {
  text: () => addText(),
  meme: addMemeText,
  caption: () => setMode('caption'),
  stickers: () => setMode('stickers'),
  arrow: addArrow,
  rect: () => addShape('rect'),
  ellipse: () => addShape('ellipse'),
  blur: addBlur,
  overlay: () => $('#overlayInput').click(),
  crop: () => setMode('crop'),
  image: () => setMode('image'),
  templates: () => setMode('templates'),
};
export const runTool = name => TOOLS[name]?.();

$('#toolrail').addEventListener('click', e => {
  const b = e.target.closest('[data-tool]');
  if (b && (S.base || b.dataset.tool === 'templates')) runTool(b.dataset.tool);
});

$('#btnOpen').onclick = () => $('#fileInput').click();
$('#dropzone').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleIncoming(f, { replace: true }); };
$('#overlayInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleIncoming(f); };
$('#templateInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btnCopy').onclick = copyImage;
$('#btnDownload').onclick = download;
document.querySelectorAll('[data-blank]').forEach(b => b.onclick = () => {
  const [w, h] = b.dataset.blank.split('x').map(Number);
  openAsBase(blankCanvas(w, h));
});

document.addEventListener('keydown', e => {
  const t = e.target, tag = t.tagName;
  const isText = tag === 'TEXTAREA' || t.isContentEditable || (tag === 'INPUT' && /^(text|search|number|email|)$/.test(t.type));
  const inForm = isText || tag === 'SELECT' || tag === 'INPUT';
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();

  if (mod && k === 's') { e.preventDefault(); download(); return; }
  if (mod && k === 'c' && !isText && S.base && !String(window.getSelection())) { e.preventDefault(); copyImage(); return; }
  if (!isText && mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (!isText && mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (isText) { if (e.key === 'Escape') t.blur(); return; }
  if (!S.base || ui.busy) return;

  const sel = selected();
  if (e.key === 'Escape') {
    if (ui.brush) stopBrush();
    else if (ui.crop) setMode('home');
    else if (sel) select(null);
    return;
  }
  if (inForm && tag !== 'INPUT') return;
  if (inForm && e.key.startsWith('Arrow')) return;
  if (e.key === 'Enter' && ui.crop) { e.preventDefault(); applyCrop(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteLayer(); return; }
  if (mod && k === 'd' && sel) { e.preventDefault(); duplicateLayer(); return; }
  if (sel && !sel.locked && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * ui.uiS;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (sel.type === 'arrow') { sel.x1 += dx; sel.x2 += dx; sel.y1 += dy; sel.y2 += dy; } else { sel.x += dx; sel.y += dy; }
    changed();
    return;
  }
  if (mod || e.altKey) return;
  if (k === 't') { e.preventDefault(); addText(); }
  else if (k === 'm') { e.preventDefault(); addMemeText(); }
  else if (k === 'c') setMode('crop');
});

document.addEventListener('paste', e => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  handleIncoming(item.getAsFile());
});

let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropOverlay').hidden = false; $('#dropOverlay div').textContent = S.base ? 'Drop to add as a layer' : 'Drop to open'; });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0; $('#dropOverlay').hidden = true;
  const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (f) handleIncoming(f); else toast('Drop an image file (PNG, JPG, GIF, WebP).');
});

window.addEventListener('beforeunload', e => { if (hasEdits()) { e.preventDefault(); e.returnValue = ''; } });

// ======================================================================
// Start up
// ======================================================================
document.body.classList.add('no-image');
injectGoogleFonts();
document.fonts?.addEventListener('loadingdone', () => { clearTextCache(); render(); });
updateButtons();
renderPanel();
renderEmptyTemplates();
loadSavedFonts().then(() => renderPanel());
store.get('presets', []).then(p => { userPresets = p; renderPanel(); });
