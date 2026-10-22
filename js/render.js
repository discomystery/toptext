// Geometry and drawing. Nothing here changes state.
import { S, ui, assets, mk } from './state.js';
import { fontCss } from './fonts.js';

const mctx = document.createElement('canvas').getContext('2d'); // for measuring text
const HAS_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
export const ACCENT = '#ffd60a';

// ---------- Small helpers ----------
export const rad = d => d * Math.PI / 180;
export function rotPt(p, c, deg) {
  if (!deg) return { x: p.x, y: p.y };
  const r = rad(deg), cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}
export function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
export const canRotate = l => l.type !== 'arrow' && l.type !== 'blur';

// ---------- Text ----------
export const textFont = l => `${l.italic ? 'italic ' : ''}${l.weight || 400} ${l.size}px ${fontCss(l.font)}`;

function measure(c, s, ls) {
  if (!ls) return c.measureText(s).width;
  const n = Array.from(s).length;
  return c.measureText(s).width + ls * Math.max(0, n - 1);
}

export function wrapLines(c, text, maxW, ls = 0) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (let word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (measure(c, test, ls) <= maxW || (!line && !word)) { line = test; continue; }
      if (line) { out.push(line); line = ''; }
      // A single word wider than the box: break it up.
      while (measure(c, word, ls) > maxW && word.length > 1) {
        const chars = Array.from(word);
        let i = chars.length - 1;
        while (i > 1 && measure(c, chars.slice(0, i).join(''), ls) > maxW) i--;
        out.push(chars.slice(0, i).join(''));
        word = chars.slice(i).join('');
      }
      line = word;
    }
    out.push(line);
  }
  return out;
}

const layoutCache = new Map();
export function textLayout(l) {
  const key = [l.text, l.font, l.weight, l.italic, l.upper, l.size, l.w, l.letterSpacing, l.lineH, l.bg, l.bgPad].join('|');
  let L = layoutCache.get(key);
  if (L) return L;
  mctx.font = textFont(l);
  const txt = l.upper ? l.text.toUpperCase() : l.text;
  const ls = l.size * (l.letterSpacing || 0) / 100;
  const padX = l.bg ? l.size * (l.bgPad ?? 30) / 100 : 0;
  const lines = wrapLines(mctx, txt, Math.max(10, l.w - padX * 2), ls);
  const lineH = l.size * (l.lineH || 1.15);
  L = { lines, lineH, padX, ls, h: Math.max(lineH, lines.length * lineH) };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, L);
  return L;
}

function drawTextLine(c, s, x, y, ls, align, mode) {
  const fn = mode === 'stroke' ? 'strokeText' : 'fillText';
  if (!ls) { c.textAlign = align; c[fn](s, x, y); return; }
  // Manual letter-spacing (works in every browser).
  const w = measure(c, s, ls);
  let cx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  c.textAlign = 'left';
  let prefix = '';
  for (const ch of Array.from(s)) {
    c[fn](ch, cx + c.measureText(prefix).width + ls * Array.from(prefix).length, y);
    prefix += ch;
  }
}

function applyShadow(c, l) {
  c.shadowColor = hexA(l.shadowColor || '#000000', (l.shadowAlpha ?? 60) / 100);
  c.shadowBlur = l.size * (l.shadowBlur || 0) / 100;
  const d = l.size * (l.shadowDist || 0) / 100;
  c.shadowOffsetX = d * 0.6;
  c.shadowOffsetY = d;
}
function clearShadow(c) { c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0; }

function drawText(c, l) {
  const L = textLayout(l);
  c.font = textFont(l);
  c.textBaseline = 'middle';
  const align = l.align || 'center';
  const ax = align === 'left' ? l.x + L.padX : align === 'right' ? l.x + l.w - L.padX : l.x + l.w / 2;
  const strokePx = l.size * (l.strokeW || 0) / 100 * 2;
  L.lines.forEach((line, i) => {
    const cy = l.y + L.lineH * (i + 0.5);
    let shadowPending = !!l.shadow;
    if (shadowPending) applyShadow(c, l);
    if (l.bg && line.trim()) {
      const tw = measure(c, line, L.ls);
      const bw = tw + L.padX * 2;
      const bx = align === 'left' ? l.x : align === 'right' ? l.x + l.w - bw : ax - bw / 2;
      c.fillStyle = l.bgColor;
      roundRect(c, bx, cy - L.lineH / 2, bw, L.lineH, Math.min(L.lineH / 2, l.size * (l.bgRadius ?? 25) / 100));
      c.fill();
      clearShadow(c); shadowPending = false;
    }
    if (strokePx > 0) {
      c.lineJoin = 'round'; c.miterLimit = 2;
      c.lineWidth = strokePx; c.strokeStyle = l.stroke;
      drawTextLine(c, line, ax, cy, L.ls, align, 'stroke');
      if (shadowPending) { clearShadow(c); shadowPending = false; }
    }
    c.fillStyle = l.fill;
    drawTextLine(c, line, ax, cy, L.ls, align, 'fill');
    clearShadow(c);
  });
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
  r = Math.min(r, w / 2, h / 2);
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// ---------- Caption bar ----------
export const captionFont = cap => `${cap.weight || 700} ${cap.size}px ${fontCss(cap.font)}`;
export function captionLayout() {
  const cap = S.caption;
  if (!cap.on || !S.base) return { h: 0, lines: [] };
  const W = S.base.width;
  mctx.font = captionFont(cap);
  const pad = Math.round(cap.size * 0.6);
  const lines = wrapLines(mctx, cap.text || '', W - pad * 2);
  const lineH = cap.size * 1.25;
  return { h: Math.round(lines.length * lineH + pad * 2), lines, lineH, pad };
}

function drawCaption(c, L, W) {
  const cap = S.caption;
  c.fillStyle = cap.bg;
  c.fillRect(0, 0, W, L.h);
  c.font = captionFont(cap);
  c.fillStyle = cap.color;
  c.textBaseline = 'middle';
  c.textAlign = cap.align;
  const x = cap.align === 'left' ? L.pad : cap.align === 'right' ? W - L.pad : W / 2;
  L.lines.forEach((line, i) => c.fillText(line, x, L.pad + L.lineH * (i + 0.5)));
}

// ---------- Geometry ----------
export function bounds(l) {
  if (l.type === 'arrow') return { x: Math.min(l.x1, l.x2), y: Math.min(l.y1, l.y2), w: Math.abs(l.x2 - l.x1), h: Math.abs(l.y2 - l.y1) };
  if (l.type === 'text') return { x: l.x, y: l.y, w: l.w, h: textLayout(l).h };
  return { x: l.x, y: l.y, w: l.w, h: l.h };
}
export function centerOf(l) { const b = bounds(l); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }

export function handlesFor(l) {
  if (l.type === 'arrow') return [{ id: 'p1', x: l.x1, y: l.y1 }, { id: 'p2', x: l.x2, y: l.y2 }];
  const b = bounds(l), c = centerOf(l), rot = l.rot || 0;
  const pts = [
    { id: 'nw', x: b.x, y: b.y }, { id: 'ne', x: b.x + b.w, y: b.y },
    { id: 'sw', x: b.x, y: b.y + b.h }, { id: 'se', x: b.x + b.w, y: b.y + b.h },
  ];
  if (l.type === 'text') pts.push({ id: 'w', x: b.x, y: c.y }, { id: 'e', x: b.x + b.w, y: c.y });
  if (l.type === 'rect' || l.type === 'ellipse' || l.type === 'blur') {
    pts.push({ id: 'n', x: c.x, y: b.y }, { id: 's', x: c.x, y: b.y + b.h }, { id: 'w', x: b.x, y: c.y }, { id: 'e', x: b.x + b.w, y: c.y });
  }
  if (canRotate(l)) pts.push({ id: 'rot', x: c.x, y: b.y - 30 * ui.uiS });
  return pts.map(p => ({ ...rotPt(p, c, rot), id: p.id }));
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function hitLayer(l, p, tol) {
  if (l.type === 'arrow') return distToSeg(p, { x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }) <= l.strokeW / 2 + tol * 1.5;
  const b = bounds(l);
  const q = rotPt(p, centerOf(l), -(l.rot || 0));
  return q.x >= b.x - tol && q.x <= b.x + b.w + tol && q.y >= b.y - tol && q.y <= b.y + b.h + tol;
}

// Call when fonts finish loading so text is re-measured with the real font.
export function clearTextCache() { layoutCache.clear(); }

// ---------- Colour adjustments (cached per base image + settings) ----------
let adjCache = { base: null, key: '', canvas: null };
export function invalidateAdjust() { adjCache.base = null; }
export function adjustedBase() {
  const a = S.adj;
  if (!a.brightness && !a.contrast && !a.saturation && !a.warmth) return S.base;
  const key = [a.brightness, a.contrast, a.saturation, a.warmth].join('|');
  if (adjCache.base === S.base && adjCache.key === key) return adjCache.canvas;
  const c = mk(S.base.width, S.base.height), g = c.getContext('2d');
  g.drawImage(S.base, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const br = a.brightness * 1.5;
  const C = a.contrast * 2.55;
  const cf = (259 * (C + 255)) / (255 * (259 - C));
  const warm = a.warmth * 0.4;
  const mkLut = shift => { const t = new Float32Array(256); for (let i = 0; i < 256; i++) t[i] = cf * (i + br + shift - 128) + 128; return t; };
  const lr = mkLut(warm), lg = mkLut(warm * 0.15), lb = mkLut(-warm);
  const s = 1 + a.saturation / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = lr[d[i]], gg = lg[d[i + 1]], b = lb[d[i + 2]];
    if (s !== 1) {
      const gray = 0.299 * r + 0.587 * gg + 0.114 * b;
      r = gray + (r - gray) * s; gg = gray + (gg - gray) * s; b = gray + (b - gray) * s;
    }
    d[i] = r; d[i + 1] = gg; d[i + 2] = b;
  }
  g.putImageData(img, 0, 0);
  adjCache = { base: S.base, key, canvas: c };
  return c;
}

// ---------- Layers ----------
function drawBlur(c, l, offY) {
  const IW = S.base.width, IH = S.base.height;
  const x = Math.max(0, Math.floor(l.x)), y = Math.max(0, Math.floor(l.y));
  const x2 = Math.min(IW, Math.ceil(l.x + l.w)), y2 = Math.min(IH, Math.ceil(l.y + l.h));
  const w = x2 - x, h = y2 - y;
  if (w < 2 || h < 2) return;
  if (l.mode === 'solid') { c.fillStyle = l.color || '#000000'; c.fillRect(x, y, w, h); return; }
  const k = Math.max(2, Math.round(Math.max(IW, IH) * l.strength / 300));
  if (l.mode === 'pixelate') {
    const sw = Math.max(1, Math.round(w / k)), sh = Math.max(1, Math.round(h / k));
    const t = mk(sw, sh), tg = t.getContext('2d');
    tg.drawImage(c.canvas, x, y + offY, w, h, 0, 0, sw, sh);
    c.imageSmoothingEnabled = false;
    c.drawImage(t, 0, 0, sw, sh, x, y, w, h);
    c.imageSmoothingEnabled = true;
    return;
  }
  // Blur: sample a margin around the area so edges blend.
  const m = k * 2;
  const sx = Math.max(0, x - m), sy = Math.max(0, y - m), ex = Math.min(IW, x2 + m), ey = Math.min(IH, y2 + m);
  const sw = ex - sx, sh = ey - sy;
  const t = mk(sw, sh), tg = t.getContext('2d');
  if (HAS_FILTER) {
    tg.filter = `blur(${k}px)`;
    tg.drawImage(c.canvas, sx, sy + offY, sw, sh, 0, 0, sw, sh);
    tg.filter = 'none';
  } else {
    const f = Math.max(2, k / 2);
    const small = mk(sw / f, sh / f);
    small.getContext('2d').drawImage(c.canvas, sx, sy + offY, sw, sh, 0, 0, small.width, small.height);
    tg.drawImage(small, 0, 0, sw, sh);
  }
  c.drawImage(t, x - sx, y - sy, w, h, x, y, w, h);
}

function drawArrow(c, l) {
  const { x1, y1, x2, y2 } = l;
  const sw = l.strokeW;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const head = Math.min(len * 0.6, Math.max(sw * 3.2, 14));
  const bx = x2 - Math.cos(ang) * head * 0.8, by = y2 - Math.sin(ang) * head * 0.8;
  const paint = (color, extra) => {
    c.strokeStyle = color; c.fillStyle = color;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = sw + extra;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(bx, by); c.stroke();
    c.beginPath();
    c.moveTo(x2 + Math.cos(ang) * extra / 2, y2 + Math.sin(ang) * extra / 2);
    c.lineTo(x2 - Math.cos(ang - 0.45) * head, y2 - Math.sin(ang - 0.45) * head);
    c.lineTo(x2 - Math.cos(ang + 0.45) * head, y2 - Math.sin(ang + 0.45) * head);
    c.closePath();
    c.lineWidth = extra || 1;
    if (extra) c.stroke();
    c.fill();
  };
  if (l.outline) paint(l.outlineColor || '#ffffff', sw * 0.8);
  paint(l.color, 0);
}

function drawShape(c, l) {
  const sw = l.strokeW || 0;
  c.beginPath();
  if (l.type === 'rect') {
    const r = Math.min(l.w, l.h) * (l.radius || 0) / 100;
    roundRect(c, l.x + sw / 2, l.y + sw / 2, Math.max(1, l.w - sw), Math.max(1, l.h - sw), r);
  } else {
    c.ellipse(l.x + l.w / 2, l.y + l.h / 2, Math.max(1, l.w / 2 - sw / 2), Math.max(1, l.h / 2 - sw / 2), 0, 0, Math.PI * 2);
  }
  if (l.fillOn) { c.fillStyle = l.fill; c.fill(); }
  if (sw > 0) { c.lineWidth = sw; c.strokeStyle = l.stroke; c.stroke(); }
}

function drawLayer(c, l, offY) {
  c.save();
  c.globalAlpha = l.opacity ?? 1;
  if (l.rot && canRotate(l)) {
    const p = centerOf(l);
    c.translate(p.x, p.y); c.rotate(rad(l.rot)); c.translate(-p.x, -p.y);
  }
  switch (l.type) {
    case 'text': drawText(c, l); break;
    case 'emoji':
      c.font = `${l.h * 0.84}px ${EMOJI_FONT}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(l.char, l.x + l.w / 2, l.y + l.h / 2 + l.h * 0.04);
      break;
    case 'rect': case 'ellipse': drawShape(c, l); break;
    case 'arrow': drawArrow(c, l); break;
    case 'blur': drawBlur(c, l, offY); break;
    case 'image': {
      const a = assets.get(l.src);
      if (a) {
        if (l.flipX) { c.translate(l.x * 2 + l.w, 0); c.scale(-1, 1); }
        c.drawImage(a, l.x, l.y, l.w, l.h);
      }
      break;
    }
  }
  c.restore();
}

/** Draw the finished document (no selection UI) onto context c, sized base.w x (base.h + caption). */
export function drawDoc(c, cap = captionLayout()) {
  const W = S.base.width, IHt = S.base.height;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  if (cap.h) drawCaption(c, cap, W);
  c.translate(0, cap.h);
  c.beginPath(); c.rect(0, 0, W, IHt); c.clip();
  if (S.bgFill) { c.fillStyle = S.bgFill; c.fillRect(0, 0, W, IHt); }
  c.drawImage(adjustedBase(), 0, 0);
  for (const l of S.layers) if (l.visible !== false) drawLayer(c, l, cap.h);
  c.restore();
}

// ---------- Editor overlay (selection, crop, guides, brush) ----------
export function drawUI(c, cap, sel) {
  const s = ui.uiS;
  c.save();
  c.translate(0, cap.h);
  const IW = S.base.width, IH = S.base.height;

  if (ui.crop) {
    const k = ui.crop;
    c.fillStyle = 'rgba(0,0,0,.6)';
    c.fillRect(0, 0, IW, k.y);
    c.fillRect(0, k.y + k.h, IW, IH - k.y - k.h);
    c.fillRect(0, k.y, k.x, k.h);
    c.fillRect(k.x + k.w, k.y, IW - k.x - k.w, k.h);
    c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = s;
    c.beginPath();
    for (let i = 1; i < 3; i++) {
      c.moveTo(k.x + k.w * i / 3, k.y); c.lineTo(k.x + k.w * i / 3, k.y + k.h);
      c.moveTo(k.x, k.y + k.h * i / 3); c.lineTo(k.x + k.w, k.y + k.h * i / 3);
    }
    c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = 2 * s;
    c.strokeRect(k.x, k.y, k.w, k.h);
    const L = 18 * s;
    c.lineWidth = 4 * s; c.strokeStyle = ACCENT;
    for (const [cx, cy, dx, dy] of [[k.x, k.y, 1, 1], [k.x + k.w, k.y, -1, 1], [k.x, k.y + k.h, 1, -1], [k.x + k.w, k.y + k.h, -1, -1]]) {
      c.beginPath(); c.moveTo(cx + dx * L, cy); c.lineTo(cx, cy); c.lineTo(cx, cy + dy * L); c.stroke();
    }
    c.restore();
    return;
  }

  if (ui.brush && ui.brushPos) {
    c.beginPath();
    c.arc(ui.brushPos.x, ui.brushPos.y, ui.brush.size * s / 2, 0, Math.PI * 2);
    c.lineWidth = 1.5 * s; c.strokeStyle = '#000'; c.stroke();
    c.setLineDash([4 * s, 4 * s]); c.strokeStyle = '#fff'; c.stroke(); c.setLineDash([]);
  }

  if (sel && !ui.brush) {
    // Two-tone outline (dark under accent) so it stays visible on any background colour.
    const outline = path => {
      c.setLineDash([]); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 3 * s; path(); c.stroke();
      c.setLineDash([5 * s, 4 * s]); c.strokeStyle = ACCENT; c.lineWidth = 1.5 * s; path(); c.stroke();
      c.setLineDash([]);
    };
    if (sel.type === 'arrow') {
      outline(() => { c.beginPath(); c.moveTo(sel.x1, sel.y1); c.lineTo(sel.x2, sel.y2); });
    } else {
      const b = bounds(sel), p = centerOf(sel);
      c.save();
      if (sel.rot && canRotate(sel)) { c.translate(p.x, p.y); c.rotate(rad(sel.rot)); c.translate(-p.x, -p.y); }
      outline(() => { c.beginPath(); c.rect(b.x, b.y, b.w, b.h); });
      if (canRotate(sel) && !sel.locked) outline(() => { c.beginPath(); c.moveTo(p.x, b.y); c.lineTo(p.x, b.y - 30 * s); });
      c.restore();
    }
    if (!sel.locked) {
      for (const h of handlesFor(sel)) {
        c.beginPath();
        if (h.id === 'rot' || h.id === 'p1' || h.id === 'p2') c.arc(h.x, h.y, 6 * s, 0, Math.PI * 2);
        else c.rect(h.x - 5 * s, h.y - 5 * s, 10 * s, 10 * s);
        c.fillStyle = h.id === 'rot' ? ACCENT : '#fff';
        c.fill(); c.lineWidth = 1.5 * s; c.strokeStyle = '#000'; c.stroke();
      }
    }
  }

  if (ui.guides) {
    c.strokeStyle = '#ff3df2'; c.lineWidth = 1 * s;
    c.beginPath();
    if (ui.guides.x != null) { c.moveTo(ui.guides.x, 0); c.lineTo(ui.guides.x, IH); }
    if (ui.guides.y != null) { c.moveTo(0, ui.guides.y); c.lineTo(IW, ui.guides.y); }
    c.stroke();
  }
  c.restore();
}

/** Render the finished document to a new canvas (used for export, thumbnails, templates). */
export function renderToCanvas(maxSide) {
  const cap = captionLayout();
  const W = S.base.width, H = S.base.height + cap.h;
  const full = mk(W, H);
  drawDoc(full.getContext('2d'), cap);
  if (!maxSide || Math.max(W, H) <= maxSide) return full;
  const s = maxSide / Math.max(W, H);
  const t = mk(W * s, H * s), g = t.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(full, 0, 0, t.width, t.height);
  return t;
}
