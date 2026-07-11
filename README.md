# pack-it-pkc

Installable TypeScript library: convert documents to Markdown, edit PDF blocks, and pack **PKC** / study PKC (RAG + flash + MCQ).

GGUF inference uses **`llama-cpp-capacitor` only** (desktop, iOS, Android, PWA).

## Install

```bash
npm install @annadata/pack-it-pkc

# Optional peers (host app)
npm install llama-cpp-capacitor          # chat / embed / vision
npm install @capacitor/filesystem       # native model download (iOS/Android/desktop Capacitor)
```

Local link while developing the host app:

```bash
npm install ../pack-it-pkc
```

## Public API

| Import | Use |
|--------|-----|
| `@annadata/pack-it-pkc` | `MarkItDown`, converters, PDF extract, `generateStudyPkc`, `packToPkc` / `packStudyPkc`, model catalog/download |
| `@annadata/pack-it-pkc/inference/capacitor` | `CapacitorGgufProvider` |
| `@annadata/pack-it-pkc/pdf/editor` | `PdfCanvasEditor` (DOM) |
| `@annadata/pack-it-pkc/pdf/editor.css` | Editor styles |

### Convert + pack

```typescript
import { MarkItDown, packToPkc, generateStudyPkc } from "@annadata/pack-it-pkc";
import { CapacitorGgufProvider } from "@annadata/pack-it-pkc/inference/capacitor";

const llm = await CapacitorGgufProvider.create();
const md = new MarkItDown({ llmProvider: llm });

// Browser / Capacitor / PWA — pass bytes (not filesystem paths)
const result = await md.convertBytes(pdfBytes, { filename: "doc.pdf", extension: ".pdf" });
const pkc = packToPkc(result.markdown, { title: result.title, source: "doc.pdf" });
```

`convertLocal("/path")` is **Node-only**. In browser/Capacitor use `convertBytes` / `convert(Uint8Array)`.

### Study PKC (RAG + flash + MCQ)

```typescript
import { generateStudyPkc } from "@annadata/pack-it-pkc";

const { document, pkc, warnings } = await generateStudyPkc(pdfBlocks, {
  llmProvider: llm,
  onProgress: console.log,
});
// document.chunks[].embedding, flashCards, mcqs — empty/partial when models missing
```

### PDF canvas editor

```typescript
import { PdfCanvasEditor } from "@annadata/pack-it-pkc/pdf/editor";
import "@annadata/pack-it-pkc/pdf/editor.css";
// Bundled KaTeX CSS + fonts (formulas) — preferred for offline / Capacitor hosts
import "@annadata/pack-it-pkc/assets/katex/katex.css";
// Optional: language fonts for future i18n UI
// import "@annadata/pack-it-pkc/assets/fonts/languages.css";

const editor = new PdfCanvasEditor({
  container,
  fileName: "doc.pdf",
  pdfBytes,
  doc: pdfBlocks,
  llmProvider: llm,
  onChange: (doc) => { /* persist */ },
});
```

### Bundled assets (formulas + languages)

Shipped under `dist/assets` as part of the plugin:

| Path | Contents |
|------|----------|
| `assets/katex/` | KaTeX CSS/JS + mhchem helpers |
| `assets/fonts/KaTeX_*` | Math fonts referenced by `katex.css` |
| `assets/fonts/{ar,hi,bn,…}.ttf` | Language fonts for future i18n |
| `assets/fonts/languages.css` | `@font-face` helpers |
| `assets/manifest` | Path helpers (`KATEX_ASSETS`, `LANGUAGE_FONT_IDS`) |

```typescript
import { KATEX_ASSETS, languageFontPath, LANGUAGE_FONTS_CSS } from "@annadata/pack-it-pkc/assets/manifest";
// Values are package imports, e.g. "@annadata/pack-it-pkc/assets/katex/katex.css"
import(KATEX_ASSETS.css);
import(LANGUAGE_FONTS_CSS);
```

### Models

```typescript
import {
  downloadModel,
  ensureModelReady,
  ensureEmbeddingModelReady,
  LFM2_CHAT_MODEL_ID,
  DEFAULT_OFFLINE_MODEL_ID,
} from "@annadata/pack-it-pkc";

await downloadModel(LFM2_CHAT_MODEL_ID, { onProgress: (p) => console.log(p.percentage) });
// PWA → OPFS; native Capacitor → @capacitor/filesystem Data dir; Node → ~/.cache/pack-it-pkc/models
await ensureModelReady(llm, LFM2_CHAT_MODEL_ID);
await ensureEmbeddingModelReady(llm, DEFAULT_OFFLINE_MODEL_ID);
```

## Architecture

```
src/
  assets/       # Shipped KaTeX + language fonts (plugin assets)
  detect/       # Magic-byte format detection (no ONNX)
  convert/      # MarkItDown + format converters
  inference/    # Catalog, download, session, CapacitorGgufProvider
  pdf/          # Block extract + PdfCanvasEditor
  pkc/          # Markdown PKC v1 + study PKC v2
  types/ utils/
```

## Host requirements

- **MuPDF** (`mupdf`) — PDF; AGPL-3.0 (see license note below)
- **KaTeX CSS** — if using formula/math preview in the editor
- **`llama-cpp-capacitor`** — AI fix / flash answers / embeddings
- **`@capacitor/filesystem`** — native model storage (optional; PWA uses OPFS)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build `dist/` (+ editor CSS) |
| `npm test` | Vitest |
| `npm run test:manual` | Local Vite harness |
| `npm run prepublishOnly` | Build + test before publish |

## License

MIT — Mr. Yakub Mohammad &lt;yakub@annadata.ai&gt;

PDF conversion uses [MuPDF.js](https://www.npmjs.com/package/mupdf) (AGPL-3.0). Distributing this library with PDF support requires complying with the AGPL; source distribution satisfies that for an open-source product.
