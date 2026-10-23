# Toptext

A fast, private image editor for memes and social posts. It runs entirely in your browser: images are never uploaded anywhere.

## What it does

- **Get images in fast:** drag and drop, paste (⌘V), open a file, or start from a blank canvas (square, 4:5, 9:16, 16:9)
- **Text:** classic top/bottom meme text, or free text boxes with ~50 fonts (or upload your own), outline, drop shadow, highlight box, letter/line spacing, rotation
- **Quick styles:** one-click presets (Meme, Highlight, Bold, Clean, Plain, Headline), plus "Save this style" for your own
- **Caption bar:** the white bar with text above the image
- **Stickers & shapes:** emoji, arrows, boxes, circles
- **Hide things:** blur, pixelate or solid-box any area
- **Layers:** reorder by dragging, show/hide, lock, rename, opacity
- **Crop:** every social ratio (1:1, 4:5, 9:16, 16:9, 1.91:1, 3:4, 2:3, 4:3, 3:1, 4:1) or free; or "fit" the whole image into a shape with a blurred/white/black background
- **Adjust:** brightness, contrast, saturation, warmth; rotate and flip
- **Background remover:** AI cutout for the main image or any image layer, plus an erase/restore brush to clean up edges
- **Templates:** save a layout and reuse it on new images; export/import a backup file
- **Export:** PNG at original size, as a download or copied to the clipboard

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| ⌘V | Paste an image |
| T / M / C | Add text / meme text / crop |
| ⌘Z, ⇧⌘Z | Undo, redo |
| ⌘D | Duplicate layer |
| ⌫ | Delete layer |
| Arrows | Nudge (⇧ for 10×) |
| ⌘C | Copy image |
| ⌘S | Download PNG |

## Running it

It's a static site with no build step. Any static file server works:

```bash
npx http-server . -p 8123
```

Then open http://localhost:8123. (Opening `index.html` directly from disk won't work, because browsers block ES modules on `file://`.)

### GitHub Pages

Push this folder to a GitHub repository, then turn on **Settings → Pages → Deploy from a branch → `main` / root**.

## Where things are stored

Templates, saved styles and uploaded fonts are saved in your browser (IndexedDB). They stay on that computer and browser, so use **Templates → Export backup** to keep a copy.

## Third-party pieces

- Fonts from [Google Fonts](https://fonts.google.com) (open licenses)
- Background removal: [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) running the [ORMBG](https://huggingface.co/onnx-community/ormbg-ONNX) model (Apache-2.0). The model downloads from Hugging Face on first use and is cached by the browser. Your images are processed locally.
