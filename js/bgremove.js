// AI background removal that runs entirely in the browser — images never leave the computer.
// Model: ORMBG (Apache-2.0) via Transformers.js (Apache-2.0). Both allow commercial use.
// The model downloads on first use (~90 MB on GPU, ~45 MB on CPU) and is cached by the browser.
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const MODEL_ID = 'onnx-community/ormbg-ONNX';

let lib = null, segmenter = null, device = null;
let gpuFailed = false;

function progressReporter(onProgress) {
  const files = {};
  return p => {
    if (p.status !== 'progress' || !p.total) return;
    files[p.file] = { loaded: p.loaded, total: p.total };
    const all = Object.values(files);
    const loaded = all.reduce((s, f) => s + f.loaded, 0);
    const total = all.reduce((s, f) => s + f.total, 0);
    onProgress?.(loaded / total, `Downloading background remover… ${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB (first time only)`);
  };
}

async function ensureSegmenter(onProgress) {
  if (segmenter) return;
  lib ||= await import(LIB_URL);
  lib.env.allowLocalModels = false;
  const progress_callback = progressReporter(onProgress);
  if (navigator.gpu && !gpuFailed) {
    try {
      segmenter = await lib.pipeline('background-removal', MODEL_ID, { device: 'webgpu', dtype: 'fp16', progress_callback });
      device = 'webgpu';
      return;
    } catch (e) {
      console.warn('WebGPU unavailable, using CPU instead', e);
      gpuFailed = true;
    }
  }
  segmenter = await lib.pipeline('background-removal', MODEL_ID, { device: 'wasm', dtype: 'q8', progress_callback });
  device = 'wasm';
}

async function segment(image, onProgress) {
  try {
    return (await segmenter([image]))[0];
  } catch (e) {
    if (device !== 'webgpu') throw e;
    // Some graphics cards can't run the model; fall back to the CPU.
    console.warn('GPU run failed, retrying on CPU', e);
    gpuFailed = true;
    segmenter = null;
    await ensureSegmenter(onProgress);
    onProgress?.(1, 'Finding the subject (using CPU, can take ~20 seconds)…');
    return (await segmenter([image]))[0];
  }
}

/** Returns a new canvas, same size as `source`, with the background made transparent. */
export async function removeBackground(source, onProgress) {
  await ensureSegmenter(onProgress);
  onProgress?.(1, device === 'wasm' ? 'Finding the subject (using CPU, can take ~20 seconds)…' : 'Finding the subject…');

  const blob = await new Promise(r => source.toBlob(r, 'image/png'));
  const image = await lib.RawImage.fromBlob(blob);
  let result = await segment(image, onProgress);
  if (result.width !== source.width || result.height !== source.height) result = await result.resize(source.width, source.height);

  // Use the model's alpha as a mask over the original full-quality pixels.
  const out = document.createElement('canvas');
  out.width = source.width; out.height = source.height;
  const g = out.getContext('2d');
  g.drawImage(source, 0, 0);
  const img = g.getImageData(0, 0, out.width, out.height);
  const d = img.data, m = result.data, ch = result.channels;
  for (let i = 0, j = ch - 1; i < d.length; i += 4, j += ch) {
    d[i + 3] = Math.min(d[i + 3], m[j]);
  }
  g.putImageData(img, 0, 0);
  return out;
}
