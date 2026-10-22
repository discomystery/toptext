// Shared editor state.
//
// Coordinates: every layer lives in "image space" — pixels of the base image, with (0,0)
// at its top-left. The optional caption bar sits above the image and is not part of that space.

export const S = {
  base: null,          // HTMLCanvasElement: the background image (treated as immutable; edits make a new canvas)
  bgFill: null,        // colour drawn behind transparent parts of the base, or null
  adj: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
  caption: defaultCaption(),
  layers: [],
};

export const ui = {
  selectedId: null,
  mode: 'home',        // which panel shows when no layer is selected
  crop: null,          // {x, y, w, h, ratio} while cropping
  cropRatio: 0,        // index into RATIOS
  brush: null,         // {target: 'base' | layerId, mode: 'erase' | 'restore', size}
  brushPos: null,
  guides: null,
  uiS: 1,              // image pixels per CSS pixel (for drawing handles at a constant on-screen size)
  busy: false,
};

export const assets = new Map();       // image-layer id -> canvas
export const originals = new WeakMap(); // canvas -> its pre-background-removal original (for the restore brush)

export function defaultCaption() {
  return { on: false, text: '', font: 'Helvetica', weight: 700, size: 48, color: '#000000', bg: '#ffffff', align: 'center' };
}

export function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function cloneCanvas(src) {
  const c = mk(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

let uid = 1;
export const newId = (p = 'L') => p + (uid++).toString(36) + Math.random().toString(36).slice(2, 6);

export const IW = () => S.base.width;
export const IH = () => S.base.height;

export const TEXT_STYLE_KEYS = [
  'font', 'weight', 'italic', 'upper', 'fill', 'stroke', 'strokeW',
  'shadow', 'shadowColor', 'shadowAlpha', 'shadowBlur', 'shadowDist',
  'bg', 'bgColor', 'bgPad', 'bgRadius', 'letterSpacing', 'lineH', 'align',
];

export const TEXT_DEFAULTS = {
  font: 'Montserrat', weight: 700, italic: false, upper: false,
  fill: '#ffffff', stroke: '#000000', strokeW: 0,
  shadow: false, shadowColor: '#000000', shadowAlpha: 60, shadowBlur: 15, shadowDist: 6,
  bg: false, bgColor: '#ffffff', bgPad: 30, bgRadius: 25,
  letterSpacing: 0, lineH: 1.15, align: 'center',
};

export const BUILTIN_PRESETS = [
  { name: 'Meme', style: { font: 'Impact', weight: 400, upper: true, fill: '#ffffff', stroke: '#000000', strokeW: 9, lineH: 1.05 } },
  { name: 'Highlight', style: { font: 'Montserrat', weight: 700, fill: '#000000', strokeW: 0, bg: true, bgColor: '#ffffff', lineH: 1.3 } },
  { name: 'Bold', style: { font: 'Montserrat', weight: 900, fill: '#ffffff', stroke: '#000000', strokeW: 4, shadow: true, shadowAlpha: 50, shadowBlur: 10, shadowDist: 5 } },
  { name: 'Clean', style: { font: 'Inter', weight: 700, fill: '#ffffff', strokeW: 0, shadow: true, shadowAlpha: 55, shadowBlur: 25, shadowDist: 3 } },
  { name: 'Plain', style: { font: 'Helvetica', weight: 400, fill: '#000000', strokeW: 0 } },
  { name: 'Headline', style: { font: 'Bebas Neue', weight: 400, upper: true, fill: '#ffd60a', stroke: '#000000', strokeW: 0, shadow: true, shadowAlpha: 80, shadowBlur: 0, shadowDist: 6, letterSpacing: 3, lineH: 1 } },
];

export const RATIOS = [
  { label: 'Free', r: null, hint: 'Any shape' },
  { label: 'Original', r: 'orig', hint: 'Keep shape' },
  { label: '1:1', r: 1, hint: 'Square posts' },
  { label: '4:5', r: 4 / 5, hint: 'IG / FB portrait' },
  { label: '9:16', r: 9 / 16, hint: 'Stories, Reels, TikTok' },
  { label: '16:9', r: 16 / 9, hint: 'X, YouTube, LinkedIn' },
  { label: '1.91:1', r: 1.91, hint: 'Link / FB / LinkedIn' },
  { label: '3:4', r: 3 / 4, hint: 'IG portrait (new)' },
  { label: '2:3', r: 2 / 3, hint: 'Pinterest' },
  { label: '4:3', r: 4 / 3, hint: 'Classic photo' },
  { label: '3:1', r: 3, hint: 'X header' },
  { label: '4:1', r: 4, hint: 'LinkedIn banner' },
];

export const EMOJIS = ('😂 🤣 💀 😭 🔥 💯 👀 🙄 😤 😎 🤡 🥲 😳 🤔 🫠 🤯 😬 🥹 😏 🫡 😮‍💨 ' +
  '👏 🙏 🤝 💪 👉 👆 🫵 ❤️ 💔 ✨ 🎉 👑 🚨 ⚠️ ❌ ✅ ⭐ 💥 💸 📈 📉 ' +
  '🧢 🐐 🍿 🗿 🤌 💅 🧠 👁️ 🎯 🏆 🔔 📣 💬 ⬆️ ⬇️ ⬅️ ➡️').split(' ');

export const SWATCHES = ['#ffffff', '#000000', '#ff2d2d', '#ff8a00', '#ffd60a', '#22c55e', '#2f80ff', '#a855f7', '#ff4fd8', '#8b8b8b'];
