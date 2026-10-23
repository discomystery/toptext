// Right-hand sidebar: contextual properties panel + layers list.
import { S, ui, assets, originals, IW, IH, BUILTIN_PRESETS, RATIOS, EMOJIS, SWATCHES, TEXT_DEFAULTS } from './state.js';
import { clearTextCache, hexA } from './render.js';
import { $, h, icon, toast } from './dom.js';
import { FONTS, GROUPS, fontCss, ensureFont, addFontFile } from './fonts.js';
import {
  render, commit, changed, select, setMode, selected, layerById, focusText, runTool,
  addEmoji, deleteLayer, duplicateLayer, moveZ, reorder, mutateText, applyStyle,
  userPresets, savePreset, deletePreset, setCropRatio, applyCrop, padTo, transformBase,
  setBgFill, removeBg, startBrush, stopBrush, getTemplates, saveTemplate, deleteTemplate,
  applyTemplate, exportBackup, importTemplates,
} from './app.js';

const panel = $('#panel');
/** Append to the panel, skipping false/null so conditional controls can be written inline. */
const put = (...kids) => panel.append(...kids.flat().filter(k => k != null && k !== false));

// ======================================================================
// Controls
// ======================================================================
function head(title, onClose) {
  return h('div', { class: 'panel-head' },
    h('h2', {}, title),
    onClose && h('button', { class: 'x', title: 'Close (Esc)', onclick: onClose }, icon('x')));
}
const section = (title, ...kids) => h('div', { class: 'section' }, title && h('div', { class: 'section-title' }, title), ...kids);
const row = (label, control) => h('div', { class: 'row' }, h('span', { class: 'row-label' }, label), control);

function slider({ min, max, step = 1, value, fmt = v => Math.round(v), onInput }) {
  const out = h('span', { class: 'val' }, fmt(value));
  const inp = h('input', { type: 'range', min, max, step });
  inp.value = value;
  inp.addEventListener('input', () => { const v = +inp.value; out.textContent = fmt(v); onInput(v); });
  return h('div', { class: 'slider' }, inp, out);
}

function colors(value, onInput, { allowNone = false } = {}) {
  const wrap = h('div', { class: 'colors' });
  const custom = h('input', { type: 'color', title: 'Custom colour' });
  custom.value = value && value.startsWith('#') ? value : '#ffffff';
  let current = value;
  const mark = () => wrap.querySelectorAll('.sw[data-c]').forEach(s => s.classList.toggle('on', s.dataset.c === String(current).toLowerCase()));
  const set = c => { current = c; if (c) custom.value = c; mark(); onInput(c); };
  if (allowNone) wrap.append(h('button', { type: 'button', class: 'sw none', 'data-c': 'null', title: 'None', onclick: () => set(null) }));
  for (const c of SWATCHES) wrap.append(h('button', { type: 'button', class: 'sw', 'data-c': c, style: `--c:${c}`, title: c, onclick: () => set(c) }));
  custom.addEventListener('input', () => set(custom.value));
  wrap.append(h('label', { class: 'sw custom', title: 'Pick any colour' }, custom));
  mark();
  return wrap;
}

function seg(options, value, onPick) {
  const w = h('div', { class: 'seg' });
  for (const o of options) {
    const b = h('button', { type: 'button', class: o.value === value ? 'on' : '', title: o.title || '' }, o.label);
    b.onclick = () => { w.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); onPick(o.value); };
    w.append(b);
  }
  return w;
}

function toggle(label, checked, onChange) {
  const i = h('input', { type: 'checkbox' });
  i.checked = !!checked;
  i.onchange = () => onChange(i.checked);
  return h('label', { class: 'toggle' }, i, h('span', { class: 'track' }), label);
}

const btn = (label, onclick, cls = '', title = '') => h('button', { type: 'button', class: 'btn ' + cls, onclick, title }, label);
const iconBtn = (name, title, onclick, cls = '') => h('button', { type: 'button', class: 'btn ' + cls, title, onclick, 'aria-label': title }, icon(name));

// ---------- Font picker ----------
let pendingFontPick = null;
$('#fontInput').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const name = await addFontFile(f);
    toast(`Added font "${name}"`);
    pendingFontPick?.(name);
  } catch (err) {
    console.error(err);
    toast("Couldn't load that font file.");
  }
};

function fontPicker(value, onPick) {
  const wrap = h('div', { class: 'fontpick' });
  const button = h('button', { type: 'button', class: 'fontpick-btn', style: `font-family:${fontCss(value)}` }, value);
  let pop = null;
  const close = () => { pop?.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); };
  const outside = e => { if (!wrap.contains(e.target)) close(); };
  const pick = name => {
    button.textContent = name;
    button.style.fontFamily = fontCss(name);
    close();
    onPick(name);
  };
  button.onclick = () => {
    if (pop) return close();
    const search = h('input', { type: 'search', placeholder: 'Search fonts…' });
    const list = h('div', { class: 'fontpick-list' });
    const fill = q => {
      list.replaceChildren();
      for (const g of GROUPS) {
        const fonts = FONTS.filter(f => f.group === g && f.name.toLowerCase().includes(q));
        if (!fonts.length) continue;
        list.append(h('div', { class: 'fontpick-group' }, g));
        for (const f of fonts) {
          list.append(h('button', { type: 'button', class: 'fontpick-item' + (f.name === value ? ' on' : ''), style: `font-family:${f.css}`, onclick: () => pick(f.name) }, f.name));
        }
      }
      if (!list.children.length) list.append(h('div', { class: 'fontpick-group' }, 'No matches'));
    };
    search.addEventListener('input', () => fill(search.value.trim().toLowerCase()));
    search.addEventListener('keydown', e => { if (e.key === 'Enter') list.querySelector('.fontpick-item')?.click(); });
    fill('');
    pop = h('div', { class: 'fontpick-pop' }, search, list,
      h('div', { class: 'fontpick-foot' }, btn('Upload a font file…', () => { pendingFontPick = pick; $('#fontInput').click(); }, 'sm')));
    wrap.append(pop);
    document.addEventListener('pointerdown', outside, true);
    search.focus();
    const on = list.querySelector('.on');
    if (on) list.scrollTop = on.offsetTop - list.clientHeight / 2;
  };
  wrap.append(button);
  return wrap;
}

const WEIGHTS = [{ value: 400, label: 'Regular' }, { value: 700, label: 'Bold' }, { value: 900, label: 'Black' }];

// ======================================================================
// Panel router
// ======================================================================
let lastKey = '';
export function renderPanel() {
  const key = `${ui.selectedId}|${ui.mode}|${!!ui.brush}`;
  const scroll = key === lastKey ? panel.scrollTop : 0;
  lastKey = key;
  panel.replaceChildren();
  const l = selected();
  document.querySelectorAll('.tool[data-mode]').forEach(b => b.classList.toggle('active', !l && !ui.brush && b.dataset.mode === ui.mode));

  if (!S.base) {
    if (ui.mode === 'templates') templatesPanel();
    else put(head('Toptext'), h('p', {}, 'Open, drop or paste an image to get started, or start from a blank canvas.'), shortcutsSection());
    return;
  }
  if (ui.brush) brushPanel();
  else if (l) layerPanel(l);
  else ({ home: homePanel, caption: captionPanel, stickers: stickersPanel, crop: cropPanel, image: imagePanel, templates: templatesPanel }[ui.mode] || homePanel)();
  panel.scrollTop = scroll;
}

/** Cheap per-frame updates (avoids rebuilding the panel). */
export function updateLive() {
  const info = $('#cropInfo');
  if (info && ui.crop) info.innerHTML = `Crop area: <b>${Math.round(ui.crop.w)} × ${Math.round(ui.crop.h)}px</b>`;
}

// ======================================================================
// Mode panels
// ======================================================================
function quick(iconName, title, sub, onclick) {
  return h('button', { type: 'button', onclick }, icon(iconName), h('div', {}, title, h('small', {}, sub)));
}

function shortcutsSection() {
  const sc = [
    ['⌘V', 'Paste an image'], ['T', 'Add text'], ['M', 'Meme text'], ['C', 'Crop'],
    ['⌘Z / ⇧⌘Z', 'Undo / redo'], ['⌘D', 'Duplicate layer'], ['⌫', 'Delete layer'],
    ['Arrows', 'Nudge (⇧ = 10×)'], ['⌘C', 'Copy image'], ['⌘S', 'Download PNG'],
    ['⌥ drag', 'Move without snapping'], ['⇧ drag', 'Snap rotation to 15°'],
  ];
  return section('Shortcuts', h('div', { class: 'shortcuts' }, sc.flatMap(([k, d]) => [h('span', {}, h('kbd', {}, k)), h('span', {}, d)])));
}

function homePanel() {
  const layers = S.layers.length;
  put(
    head('Edit'),
    h('div', { class: 'info' }, 'Image: ', h('b', {}, `${IW()} × ${IH()}px`), layers ? ` · ${layers} layer${layers > 1 ? 's' : ''}` : ''),
    section('', h('div', { class: 'quick' },
      quick('meme', 'Meme text', 'Classic top & bottom captions', () => runTool('meme')),
      quick('text', 'Add text', 'A text box you can style any way', () => runTool('text')),
      quick('caption', 'Caption bar', 'White bar with text above the image', () => setMode('caption')),
      quick('crop', 'Crop for socials', '1:1, 4:5, 9:16, 16:9 and more', () => setMode('crop')),
      quick('blur', 'Hide something', 'Blur, pixelate or black out', () => runTool('blur')),
      quick('wand', 'Remove background', 'Cut out the subject', () => setMode('image')),
      quick('layout', 'Templates', 'Save or reuse a layout', () => setMode('templates')),
    )),
    shortcutsSection(),
  );
}

function captionPanel() {
  const c = S.caption;
  const ta = h('textarea', { id: 'captionText', rows: 3, placeholder: 'When you finally…' });
  ta.value = c.text;
  ta.addEventListener('input', () => { c.text = ta.value; changed(); });
  put(
    head('Caption bar', () => setMode('home')),
    section('', toggle('Show caption bar', c.on, v => { c.on = v; commit(); render(); renderLayers(); })),
    section('Text', ta),
    section('Style',
      fontPicker(c.font, name => { c.font = name; ensureFont(name, c.weight).then(render); changed(); }),
      seg(WEIGHTS, c.weight, v => { c.weight = v; ensureFont(c.font, v).then(render); changed(); }),
      row('Size', slider({ min: 10, max: Math.max(80, Math.round(IW() / 6)), value: c.size, onInput: v => { c.size = v; changed(); } })),
      row('Align', seg([{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }], c.align, v => { c.align = v; changed(); })),
      row('Text', colors(c.color, v => { c.color = v; changed(); })),
      row('Bar', colors(c.bg, v => { c.bg = v; changed(); })),
    ),
  );
}

function stickersPanel() {
  const custom = h('input', { type: 'text', placeholder: 'Type or paste any emoji or symbol', maxlength: 8 });
  const addCustom = () => { const v = custom.value.trim(); if (v) addEmoji(v); };
  custom.addEventListener('keydown', e => { if (e.key === 'Enter') addCustom(); });
  put(
    head('Stickers', () => setMode('home')),
    section('Emoji', h('div', { class: 'emoji-grid' }, EMOJIS.map(ch => h('button', { type: 'button', title: 'Add ' + ch, onclick: () => addEmoji(ch) }, ch)))),
    section('Custom', h('div', { style: 'display:grid;grid-template-columns:1fr auto;gap:6px' }, custom, btn('Add', addCustom, 'sm'))),
    section('Shapes', h('div', { class: 'grid2' },
      btn([icon('arrow'), 'Arrow'], () => runTool('arrow')),
      btn([icon('rect'), 'Box'], () => runTool('rect')),
      btn([icon('ellipse'), 'Circle'], () => runTool('ellipse')),
      btn([icon('blur'), 'Blur box'], () => runTool('blur')),
    )),
    section('Images', btn([icon('image'), 'Add an image layer'], () => runTool('overlay'), 'block'),
      h('p', { class: 'small' }, 'Tip: you can also paste (⌘V) or drop an image to add it as a layer.')),
  );
}

function ratioShape(r) {
  if (!r || r === 'orig') return h('span', { class: 'shape', style: 'width:16px;height:12px;border-style:dashed' });
  const w = r >= 1 ? 20 : 20 * r, hh = r >= 1 ? 20 / r : 20;
  return h('span', { class: 'shape', style: `width:${Math.max(6, w)}px;height:${Math.max(5, hh)}px` });
}

function cropPanel() {
  let padFill = ui.padFill || 'blur';
  const ratio = RATIOS[ui.cropRatio];
  const padR = ratio.r === 'orig' ? null : ratio.r;
  put(
    head('Crop & size', () => setMode('home')),
    h('p', { class: 'small' }, 'Pick a shape, then drag the box (or its corners) to frame the shot.'),
    section('Shape', h('div', { class: 'ratios' }, RATIOS.map((r, i) =>
      h('button', { type: 'button', class: 'ratio' + (i === ui.cropRatio ? ' on' : ''), onclick: () => { setCropRatio(i); renderPanel(); } },
        ratioShape(r.r), r.label, h('small', {}, r.hint))))),
    h('div', { class: 'info', id: 'cropInfo' }),
    section('', h('div', { class: 'grid2' },
      btn('Reset', () => setCropRatio(ui.cropRatio)),
      btn('Apply crop', applyCrop, 'primary', 'Enter'))),
    section('Or fit without cropping',
      h('p', { class: 'small' }, padR ? `Adds space around the image to make it ${ratio.label} without cutting anything off.` : 'Pick a shape above (like 9:16) to fit the whole image into it.'),
      row('Fill', seg([{ value: 'blur', label: 'Blurred' }, { value: '#ffffff', label: 'White' }, { value: '#000000', label: 'Black' }, { value: 'transparent', label: 'None' }],
        padFill, v => { ui.padFill = padFill = v; })),
      fitButton(padR, ratio, () => padFill),
    ),
    section('Rotate & flip', h('div', { class: 'actions' },
      iconBtn('rotL', 'Rotate left', () => transformBase('ccw')),
      iconBtn('rotR', 'Rotate right', () => transformBase('cw')),
      iconBtn('flipH', 'Flip horizontally', () => transformBase('h')),
      iconBtn('flipV', 'Flip vertically', () => transformBase('v')))),
  );
  updateLive();
}
function fitButton(padR, ratio, getFill) {
  const b = btn(padR ? `Fit to ${ratio.label}` : 'Fit to shape', () => padR && padTo(padR, getFill()), 'block');
  b.disabled = !padR;
  return b;
}

function imagePanel() {
  const a = S.adj;
  const adjRow = (label, key) => row(label, slider({ min: -100, max: 100, value: a[key], onInput: v => { a[key] = v; changed(); } }));
  const hasOriginal = originals.has(S.base);
  put(
    head('Adjust image', () => setMode('home')),
    section('Colour',
      adjRow('Brightness', 'brightness'),
      adjRow('Contrast', 'contrast'),
      adjRow('Saturation', 'saturation'),
      adjRow('Warmth', 'warmth'),
      h('div', { class: 'grid2' },
        btn('Black & white', () => { a.saturation = -100; commit(); render(); renderPanel(); }),
        btn('Reset', () => { Object.assign(a, { brightness: 0, contrast: 0, saturation: 0, warmth: 0 }); commit(); render(); renderPanel(); })),
    ),
    section('Background',
      btn([icon('wand'), 'Remove background'], () => removeBg('base'), 'block primary'),
      hasOriginal && btn([icon('brush'), 'Touch up edges'], () => startBrush('base'), 'block'),
      h('p', { class: 'small' }, 'Runs privately in your browser. The first time, it downloads the AI model (about 45–90 MB), which can take a minute.'),
      row('Fill behind', colors(S.bgFill, v => setBgFill(v), { allowNone: true })),
    ),
    section('Rotate & flip', h('div', { class: 'actions' },
      iconBtn('rotL', 'Rotate left', () => transformBase('ccw')),
      iconBtn('rotR', 'Rotate right', () => transformBase('cw')),
      iconBtn('flipH', 'Flip horizontally', () => transformBase('h')),
      iconBtn('flipV', 'Flip vertically', () => transformBase('v')))),
  );
}

function brushPanel() {
  const b = ui.brush;
  const isBase = b.target === 'base';
  put(
    head('Touch up', stopBrush),
    h('p', { class: 'small' }, 'Paint on the image. Erase removes leftover background; Restore brings back parts the AI removed by mistake.'),
    section('Brush',
      seg([{ value: 'erase', label: 'Erase' }, { value: 'restore', label: 'Restore' }], b.mode, v => { b.mode = v; }),
      row('Size', slider({ min: 4, max: 200, value: b.size, onInput: v => { b.size = v; render(); } })),
    ),
    section('', btn('Done', stopBrush, 'primary block')),
    !isBase && h('p', { class: 'small' }, 'Tip: undo (⌘Z) works per brush stroke.'),
  );
}

async function templatesPanel() {
  const name = h('input', { type: 'text', placeholder: 'Template name, e.g. "Weekly tip"' });
  let includeBase = false;
  let fit = ui.tplFit ?? true;
  const list = h('div', { class: 'tpl-list' });
  const saveBtn = btn('Save template', async () => {
    const n = name.value.trim() || `Template ${new Date().toLocaleDateString()}`;
    saveBtn.disabled = true;
    await saveTemplate(n, includeBase);
    renderPanel();
  }, 'primary block');

  put(
    head('Templates', S.base ? () => setMode('home') : null),
    S.base
      ? section('Save current layout',
        h('p', { class: 'small' }, 'Saves your text, styles, stickers, caption bar and adjustments so you can reuse them on a new image.'),
        name,
        toggle('Include the background image', false, v => { includeBase = v; }),
        saveBtn)
      : h('p', {}, 'Pick a template to start, or open an image first to save a new one.'),
    section('Saved templates', S.base && toggle('Crop new image to the template\'s shape', fit, v => { ui.tplFit = fit = v; }), list),
    section('Backup',
      h('p', { class: 'small' }, 'Templates live in this browser. Export a backup file to keep them safe or move them to another computer.'),
      h('div', { class: 'grid2' }, btn('Export backup', exportBackup), btn('Import', importTemplates))),
  );
  const tpls = await getTemplates();
  fillTemplates(list, tpls, t => applyTemplate(t, { fit }), true);
}

function fillTemplates(list, tpls, onApply, allowDelete) {
  list.replaceChildren();
  if (!tpls.length) { list.append(h('div', { class: 'muted small', style: 'grid-column:1/-1' }, 'No templates yet.')); return; }
  for (const t of tpls) {
    const del = allowDelete && h('button', { type: 'button', class: 'del', title: 'Delete template', onclick: async e => {
      e.stopPropagation();
      if (!confirm(`Delete template "${t.name}"?`)) return;
      await deleteTemplate(t.id);
      renderPanel();
    } }, icon('x'));
    list.append(h('div', { class: 'tpl', role: 'button', tabindex: 0, title: `Use "${t.name}"`, onclick: () => onApply(t), onkeydown: e => { if (e.key === 'Enter') onApply(t); } },
      h('img', { src: t.thumb, alt: '' }),
      h('div', { class: 'name' }, t.name),
      del));
  }
}

export async function renderEmptyTemplates() {
  const box = $('#emptyTemplates');
  const tpls = await getTemplates();
  box.replaceChildren();
  if (!tpls.length) return;
  const list = h('div', { class: 'tpl-list' });
  fillTemplates(list, tpls.slice(0, 8), t => applyTemplate(t), false);
  box.append(h('h3', {}, 'Start from a template'), list);
}

// ======================================================================
// Layer panels
// ======================================================================
const TYPE_TITLES = { text: 'Text', emoji: 'Sticker', rect: 'Box', ellipse: 'Circle', arrow: 'Arrow', blur: 'Hide area', image: 'Image' };

function layerPanel(l) {
  put(head(TYPE_TITLES[l.type], () => select(null)));
  if (l.locked) put(h('p', { class: 'small' }, 'This layer is locked. Unlock it in the layers list to move it on the canvas.'));
  ({ text: textPanel, emoji: emojiPanel, rect: shapePanel, ellipse: shapePanel, arrow: arrowPanel, blur: blurPanel, image: imageLayerPanel }[l.type])(l);

  const rotRow = (l.type !== 'arrow' && l.type !== 'blur') && row('Rotation', slider({ min: -180, max: 180, value: l.rot || 0, fmt: v => Math.round(v) + '°', onInput: v => { l.rot = v; changed(); } }));
  put(section('Layer',
    row('Opacity', slider({ min: 0, max: 100, value: Math.round((l.opacity ?? 1) * 100), fmt: v => v + '%', onInput: v => { l.opacity = v / 100; changed(); } })),
    rotRow,
    h('div', { class: 'actions' },
      iconBtn('copy', 'Duplicate (⌘D)', () => duplicateLayer(l.id)),
      iconBtn('up', 'Bring forward', () => moveZ(l.id, 1)),
      iconBtn('down', 'Send backward', () => moveZ(l.id, -1)),
      iconBtn('trash', 'Delete (⌫)', () => deleteLayer(l.id), 'danger')),
  ));
}

function presetTile(p, l, onDelete) {
  const st = { ...TEXT_DEFAULTS, ...p.style };
  const css = [
    `font-family:${fontCss(st.font)}`, `font-weight:${st.weight}`, `color:${st.fill}`,
    st.italic ? 'font-style:italic' : '', st.upper ? 'text-transform:uppercase' : '',
    st.strokeW ? `-webkit-text-stroke:${Math.min(2, st.strokeW / 5)}px ${st.stroke};paint-order:stroke fill` : '',
    st.shadow ? `text-shadow:${st.shadowDist / 10}px ${st.shadowDist / 6}px ${st.shadowBlur / 6}px ${hexA(st.shadowColor, st.shadowAlpha / 100)}` : '',
    st.bg ? `background:${st.bgColor};padding:2px 6px;border-radius:4px` : '',
  ].filter(Boolean).join(';');
  ensureFont(st.font, st.weight);
  return h('div', {},
    h('button', { type: 'button', class: 'preset', title: `Apply "${p.name}" style`, onclick: () => applyStyle(l, p.style) },
      h('span', { style: css }, 'Aa'),
      onDelete && h('span', { class: 'del', role: 'button', title: 'Delete style', onclick: e => { e.stopPropagation(); onDelete(); } }, '×')),
    h('div', { class: 'preset-label' }, p.name));
}

function textPanel(l) {
  const upd = fn => v => { mutateText(l, () => fn(v)); changed(); };
  const fontChange = () => ensureFont(l.font, l.weight, l.italic).then(() => { clearTextCache(); render(); });

  const ta = h('textarea', { id: 'layerText', rows: 3, placeholder: 'Type your text…' });
  ta.value = l.text;
  ta.addEventListener('input', () => { mutateText(l, () => { l.text = ta.value; }); changed(); });

  const presets = h('div', { class: 'presets' },
    BUILTIN_PRESETS.map(p => presetTile(p, l)),
    userPresets.map(p => presetTile(p, l, () => deletePreset(p.id))));
  const saveStyle = btn([icon('plus'), 'Save this style'], () => {
    const n = prompt('Name this style:', 'My style');
    if (n?.trim()) savePreset(n.trim(), l);
  }, 'sm');

  put(
    section('Text', ta),
    section('Quick styles', presets, saveStyle),
    section('Font',
      fontPicker(l.font, name => { mutateText(l, () => { l.font = name; }); fontChange(); changed(); }),
      seg(WEIGHTS, l.weight, v => { mutateText(l, () => { l.weight = v; }); fontChange(); changed(); }),
      row('Size', slider({ min: 6, max: Math.max(200, Math.round(IW() / 2.5)), value: Math.round(l.size), onInput: upd(v => { l.size = v; }) })),
      row('Align', seg([{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }], l.align, v => { l.align = v; changed(); })),
      h('div', { class: 'flex-wrap', style: 'gap:16px' },
        toggle('ALL CAPS', l.upper, upd(v => { l.upper = v; })),
        toggle('Italic', l.italic, v => { l.italic = v; fontChange(); changed(); })),
    ),
    section('Colour', colors(l.fill, v => { l.fill = v; changed(); })),
    section('Outline',
      row('Thickness', slider({ min: 0, max: 25, value: l.strokeW, onInput: v => { l.strokeW = v; changed(); } })),
      row('Colour', colors(l.stroke, v => { l.stroke = v; changed(); })),
    ),
    section('Shadow',
      toggle('Drop shadow', l.shadow, v => { l.shadow = v; changed(); renderPanel(); }),
      l.shadow && row('Colour', colors(l.shadowColor, v => { l.shadowColor = v; changed(); })),
      l.shadow && row('Opacity', slider({ min: 0, max: 100, value: l.shadowAlpha, fmt: v => v + '%', onInput: v => { l.shadowAlpha = v; changed(); } })),
      l.shadow && row('Softness', slider({ min: 0, max: 60, value: l.shadowBlur, onInput: v => { l.shadowBlur = v; changed(); } })),
      l.shadow && row('Distance', slider({ min: 0, max: 30, value: l.shadowDist, onInput: v => { l.shadowDist = v; changed(); } })),
    ),
    section('Highlight box',
      toggle('Box behind each line', l.bg, upd(v => { l.bg = v; renderPanel(); })),
      l.bg && row('Colour', colors(l.bgColor, v => { l.bgColor = v; changed(); })),
      l.bg && row('Padding', slider({ min: 0, max: 80, value: l.bgPad, onInput: upd(v => { l.bgPad = v; }) })),
      l.bg && row('Rounding', slider({ min: 0, max: 60, value: l.bgRadius, onInput: v => { l.bgRadius = v; changed(); } })),
    ),
    section('Spacing',
      row('Letters', slider({ min: -10, max: 50, value: l.letterSpacing, onInput: upd(v => { l.letterSpacing = v; }) })),
      row('Lines', slider({ min: 0.7, max: 2, step: 0.05, value: l.lineH, fmt: v => v.toFixed(2), onInput: upd(v => { l.lineH = v; }) })),
    ),
  );
}

function emojiPanel(l) {
  put(
    section('Swap sticker', h('div', { class: 'emoji-grid' }, EMOJIS.map(ch => h('button', { type: 'button', onclick: () => { l.char = ch; commit(); render(); renderLayers(); } }, ch)))),
    section('', row('Size', slider({ min: 10, max: Math.round(Math.max(IW(), IH())), value: Math.round(l.w), onInput: v => {
      const c = { x: l.x + l.w / 2, y: l.y + l.h / 2 };
      l.w = l.h = v; l.x = c.x - v / 2; l.y = c.y - v / 2; changed();
    } }))),
  );
}

function shapePanel(l) {
  put(
    section('Outline',
      row('Thickness', slider({ min: 0, max: Math.max(40, Math.round(IW() / 25)), value: l.strokeW, onInput: v => { l.strokeW = v; changed(); } })),
      row('Colour', colors(l.stroke, v => { l.stroke = v; changed(); })),
    ),
    section('Fill',
      toggle('Fill shape', l.fillOn, v => { l.fillOn = v; changed(); renderPanel(); }),
      l.fillOn && row('Colour', colors(l.fill, v => { l.fill = v; changed(); })),
    ),
    l.type === 'rect' && section('', row('Rounding', slider({ min: 0, max: 50, value: l.radius || 0, onInput: v => { l.radius = v; changed(); } }))),
  );
}

function arrowPanel(l) {
  put(
    section('Arrow',
      row('Colour', colors(l.color, v => { l.color = v; changed(); })),
      row('Thickness', slider({ min: 2, max: Math.max(60, Math.round(IW() / 20)), value: l.strokeW, onInput: v => { l.strokeW = v; changed(); } })),
    ),
    section('Outline',
      toggle('Outline (stands out on busy photos)', l.outline, v => { l.outline = v; changed(); renderPanel(); }),
      l.outline && row('Colour', colors(l.outlineColor, v => { l.outlineColor = v; changed(); })),
    ),
    h('p', { class: 'small' }, 'Drag the round handles to aim it. Hold ⇧ to snap to 45°.'),
  );
}

function blurPanel(l) {
  put(
    section('Hide with',
      seg([{ value: 'blur', label: 'Blur' }, { value: 'pixelate', label: 'Pixelate' }, { value: 'solid', label: 'Solid box' }], l.mode, v => { l.mode = v; changed(); renderPanel(); renderLayers(); }),
      l.mode === 'solid'
        ? row('Colour', colors(l.color, v => { l.color = v; changed(); }))
        : row('Strength', slider({ min: 1, max: 10, value: l.strength, onInput: v => { l.strength = v; changed(); } })),
    ),
    h('p', { class: 'small' }, 'Hides everything beneath it in the layer stack. Move it above any layer you also want hidden.'),
  );
}

function imageLayerPanel(l) {
  const a = assets.get(l.src);
  put(
    section('Background',
      btn([icon('wand'), 'Remove background'], () => removeBg(l.id), 'block primary'),
      a && originals.has(a) && btn([icon('brush'), 'Touch up edges'], () => startBrush(l.id), 'block'),
      h('p', { class: 'small' }, 'Runs privately in your browser. First use downloads the AI model (about 45–90 MB).'),
    ),
    section('Transform', h('div', { class: 'grid2' },
      btn([icon('flipH'), 'Flip'], () => { l.flipX = !l.flipX; commit(); render(); }),
      btn('Fit to image', () => {
        const r = l.w / l.h;
        let w = IW(), hh = w / r;
        if (hh > IH()) { hh = IH(); w = hh * r; }
        Object.assign(l, { w, h: hh, x: (IW() - w) / 2, y: (IH() - hh) / 2, rot: 0 });
        commit(); render(); renderPanel();
      }),
    )),
  );
}

// ======================================================================
// Layers list
// ======================================================================
export function layerName(l) {
  if (l.name) return l.name;
  switch (l.type) {
    case 'text': return (l.text.trim().split('\n')[0] || 'Empty text').slice(0, 40);
    case 'emoji': return `Sticker ${l.char}`;
    case 'rect': return 'Box';
    case 'ellipse': return 'Circle';
    case 'arrow': return 'Arrow';
    case 'blur': return { blur: 'Blur', pixelate: 'Pixelate', solid: 'Solid box' }[l.mode];
    case 'image': return 'Image';
  }
  return 'Layer';
}

function typeIcon(l) {
  if (l.type === 'text') return h('span', { class: 'lt-icon' }, 'T');
  if (l.type === 'emoji') return h('span', { class: 'lt-icon', style: 'font-size:15px' }, l.char);
  return h('span', { class: 'lt-icon' }, icon(l.type));
}

let dragId = null;

export function renderLayers() {
  const list = $('#layerList');
  list.replaceChildren();
  if (!S.base) return;

  if (S.caption.on) {
    list.append(h('li', { class: 'layer-row fixed' + (!ui.selectedId && ui.mode === 'caption' ? ' sel' : ''), onclick: () => setMode('caption') },
      h('button', { type: 'button', class: 'ib', title: 'Hide caption bar', onclick: e => { e.stopPropagation(); S.caption.on = false; commit(); render(); renderLayers(); renderPanel(); } }, icon('eye')),
      h('span', { class: 'lt-icon' }, icon('caption')),
      h('span', { class: 'lt-name' }, 'Caption bar'),
      h('span')));
  }

  for (let i = S.layers.length - 1; i >= 0; i--) {
    const l = S.layers[i];
    const hidden = l.visible === false;
    const nameEl = h('span', { class: 'lt-name', title: 'Double-click to rename' }, layerName(l));
    nameEl.ondblclick = e => {
      e.stopPropagation();
      const inp = h('input', { type: 'text', value: layerName(l) });
      const done = save => {
        if (save) { const v = inp.value.trim(); l.name = v && v !== layerName({ ...l, name: '' }) ? v : ''; commit(); }
        renderLayers();
      };
      inp.onkeydown = ev => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
      nameEl.replaceChildren(inp);
      inp.focus(); inp.select();
    };
    const li = h('li', {
      class: 'layer-row' + (l.id === ui.selectedId ? ' sel' : '') + (hidden ? ' hidden-layer' : ''),
      draggable: 'true',
      onclick: () => select(l.id),
    },
    h('button', { type: 'button', class: 'ib', title: hidden ? 'Show' : 'Hide', onclick: e => { e.stopPropagation(); l.visible = hidden; commit(); render(); renderLayers(); } }, icon(hidden ? 'eyeOff' : 'eye')),
    typeIcon(l),
    nameEl,
    h('button', { type: 'button', class: 'ib' + (l.locked ? ' on-lock' : ''), title: l.locked ? 'Unlock' : 'Lock (stops accidental moves)', onclick: e => { e.stopPropagation(); l.locked = !l.locked; commit(); render(); renderLayers(); renderPanel(); } }, icon(l.locked ? 'lock' : 'unlock')));

    li.addEventListener('dragstart', e => { dragId = l.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id); });
    li.addEventListener('dragend', () => { dragId = null; list.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
    li.addEventListener('dragover', e => {
      if (!dragId || dragId === l.id) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      li.classList.toggle('drop-before', before);
      li.classList.toggle('drop-after', !before);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', e => {
      if (!dragId || dragId === l.id) return;
      e.preventDefault();
      const before = li.classList.contains('drop-before');
      const id = dragId; dragId = null;
      // The list is shown top-first, so "before" in the list means "above" in the stack.
      const rest = S.layers.filter(x => x.id !== id);
      const target = rest.findIndex(x => x.id === l.id);
      reorder(id, before ? target + 1 : target);
    });
    list.append(li);
  }

  if (!S.layers.length) list.append(h('li', { class: 'layers-empty' }, 'Text, stickers and shapes you add will show up here.'));

  list.append(h('li', { class: 'layer-row fixed' + (!ui.selectedId && ui.mode === 'image' ? ' sel' : ''), onclick: () => setMode('image') },
    h('span', { class: 'ib ghost' }),
    h('span', { class: 'lt-icon' }, icon('image')),
    h('span', { class: 'lt-name' }, `Background · ${IW()}×${IH()}`),
    h('span')));
}
