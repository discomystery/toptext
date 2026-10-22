// Font catalogue: Google Fonts (loaded on demand) + system fonts + fonts the user uploads.
import * as store from './store.js';

const G = (name, group, weights) => ({ name, group, css: `"${name}"`, google: weights ? `${name.replace(/ /g, '+')}:wght@${weights}` : name.replace(/ /g, '+') });
const SYS = (name, css, group) => ({ name, group, css, system: true });

export const FONTS = [
  SYS('Impact', 'Impact, "Anton", "Arial Narrow", sans-serif', 'Meme & impact'),
  G('Anton', 'Meme & impact'),
  G('Bebas Neue', 'Meme & impact'),
  G('Oswald', 'Meme & impact', '400;700'),
  G('Archivo Black', 'Meme & impact'),
  G('League Gothic', 'Meme & impact'),
  G('Bangers', 'Meme & impact'),

  G('Inter', 'Sans serif', '400;700;900'),
  G('Montserrat', 'Sans serif', '400;700;900'),
  G('Poppins', 'Sans serif', '400;700;900'),
  G('Roboto', 'Sans serif', '400;700;900'),
  G('Open Sans', 'Sans serif', '400;700;800'),
  G('Lato', 'Sans serif', '400;700;900'),
  G('Work Sans', 'Sans serif', '400;700;900'),
  G('DM Sans', 'Sans serif', '400;700;900'),
  G('Raleway', 'Sans serif', '400;700;900'),
  G('Nunito', 'Sans serif', '400;700;900'),
  G('Rubik', 'Sans serif', '400;700;900'),
  G('Barlow', 'Sans serif', '400;700;900'),
  G('Space Grotesk', 'Sans serif', '400;700'),
  SYS('Helvetica', '"Helvetica Neue", Helvetica, Arial, sans-serif', 'Sans serif'),
  SYS('Arial', 'Arial, Helvetica, sans-serif', 'Sans serif'),

  G('Playfair Display', 'Serif', '400;700;900'),
  G('Merriweather', 'Serif', '400;700;900'),
  G('Lora', 'Serif', '400;700'),
  G('DM Serif Display', 'Serif'),
  G('Libre Baskerville', 'Serif', '400;700'),
  G('EB Garamond', 'Serif', '400;700'),
  G('Abril Fatface', 'Serif'),
  SYS('Georgia', 'Georgia, serif', 'Serif'),
  SYS('Times', '"Times New Roman", Times, serif', 'Serif'),

  G('Bungee', 'Display'),
  G('Lobster', 'Display'),
  G('Righteous', 'Display'),
  G('Alfa Slab One', 'Display'),
  G('Black Ops One', 'Display'),
  G('Bowlby One', 'Display'),
  G('Shrikhand', 'Display'),
  G('Rubik Mono One', 'Display'),
  G('Monoton', 'Display'),
  G('Press Start 2P', 'Display'),

  G('Permanent Marker', 'Handwritten'),
  G('Caveat', 'Handwritten', '400;700'),
  G('Pacifico', 'Handwritten'),
  G('Dancing Script', 'Handwritten', '400;700'),
  G('Kalam', 'Handwritten', '400;700'),
  G('Indie Flower', 'Handwritten'),
  G('Shadows Into Light', 'Handwritten'),
  G('Gloria Hallelujah', 'Handwritten'),
  G('Comic Neue', 'Handwritten', '400;700'),
  SYS('Comic Sans', '"Comic Sans MS", "Comic Neue", cursive', 'Handwritten'),

  G('Space Mono', 'Monospace', '400;700'),
  G('JetBrains Mono', 'Monospace', '400;700;800'),
  SYS('Courier', '"Courier New", Courier, monospace', 'Monospace'),
];

export const GROUPS = ['Your fonts', 'Meme & impact', 'Sans serif', 'Serif', 'Display', 'Handwritten', 'Monospace'];

export function fontCss(name) {
  const f = FONTS.find(f => f.name === name);
  return f ? f.css : `"${name}", sans-serif`;
}

// Inject the Google Fonts stylesheet. Font files themselves only download when a font is used.
export function injectGoogleFonts() {
  const fams = FONTS.filter(f => f.google).map(f => f.google);
  // Split into a few requests so the URLs stay short.
  for (let i = 0; i < fams.length; i += 18) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + fams.slice(i, i + 18).map(f => 'family=' + f).join('&') + '&display=swap';
    document.head.append(link);
  }
}

// Resolve once the given font/weight is ready to draw on a canvas.
export function ensureFont(name, weight = 400, italic = false) {
  if (!document.fonts) return Promise.resolve();
  return document.fonts.load(`${italic ? 'italic ' : ''}${weight} 40px ${fontCss(name)}`, 'AaBb').catch(() => {});
}

// ---- Custom (uploaded) fonts, persisted in IndexedDB ----
async function registerCustom(name, buf) {
  const face = new FontFace(name, buf);
  await face.load();
  document.fonts.add(face);
  if (!FONTS.some(f => f.name === name)) FONTS.unshift({ name, group: 'Your fonts', css: `"${name}"`, custom: true });
}

export async function loadSavedFonts() {
  const saved = await store.get('fonts', []);
  for (const f of saved) {
    try { await registerCustom(f.name, f.buf); } catch (e) { console.warn('Could not load saved font', f.name, e); }
  }
}

export async function addFontFile(file) {
  const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Custom font';
  const buf = await file.arrayBuffer();
  await registerCustom(name, buf.slice(0));
  const saved = await store.get('fonts', []);
  await store.set('fonts', [...saved.filter(f => f.name !== name), { name, buf }]);
  return name;
}

export async function removeFont(name) {
  const saved = await store.get('fonts', []);
  await store.set('fonts', saved.filter(f => f.name !== name));
  const i = FONTS.findIndex(f => f.name === name && f.custom);
  if (i >= 0) FONTS.splice(i, 1);
}
