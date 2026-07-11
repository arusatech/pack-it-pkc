# pack-it-pkc

Convert documents to Markdown and pack them into **PKC** format.

JavaScript/TypeScript port of [Microsoft MarkItDown](ref-code/markitdown) with:

- **No ONNX** — format detection uses magic bytes + `file-type` (replaces Magika/onnxruntime)
- **GGUF inference** — vision/OCR via llama.cpp adapters (replaces cloud LLM for on-device use)
- **Multi-platform** — installable library for desktop, iOS, Android, and PWA (GGUF via `llama-cpp-capacitor`)

## Architecture

```
src/
  detect/       # Format detection (magic bytes, MIME/extension inference)
  convert/      # MarkItDown orchestrator + format converters
  inference/    # GGUF via llama-cpp-capacitor (desktop / iOS / Android / PWA)
  pdf/          # PDF block extraction + canvas editor helpers
  pkc/          # PKC binary container (markdown + study v2)
  types/        # StreamInfo, DocumentConverter, exceptions
  utils/        # ByteStream, URI parsing, normalization

test/
  mark-it-down.test.ts
  manual-convert/   # Local Vite harness (not a product UI)

ref-code/
  markitdown/   # Original Python reference (gitignored)
```

### Format detection (replaces Magika/ONNX)

Python MarkItDown uses Magika, which runs a small ONNX model. This port uses:

1. Magic-byte signatures for PDF, ZIP/Office, images, HTML, JSON
2. [`file-type`](https://www.npmjs.com/package/file-type) when available
3. Extension ↔ MIME cross-inference
4. `chardet` for text charset

### GGUF inference (replaces OpenAI vision / ONNX OCR)

One runtime for all targets: [`llama-cpp-capacitor`](https://www.npmjs.com/package/llama-cpp-capacitor) (native on iOS/Android/desktop hosts, WASM + OPFS on PWA).

```typescript
import { MarkItDown } from "@annadata/pack-it-pkc";
import { CapacitorGgufProvider } from "@annadata/pack-it-pkc/inference/capacitor";

const llm = await CapacitorGgufProvider.create();
await llm.loadModel({ modelPath: "models/llava.gguf" });

const md = new MarkItDown({ llmProvider: llm });
const result = await md.convert("/path/to/scan.png");
```

### Supported converters

| Format | Converter | Notes |
|--------|-----------|-------|
| txt, md, json | PlainText | ✅ |
| html | Html | cheerio + turndown |
| csv | Csv | Markdown tables |
| ipynb | Ipynb | Notebook cells |
| pdf | Pdf | MuPDF.js (WASM) tables/forms + plain text |
| epub | Epub | OPF spine + HTML chapters |
| rss, atom | Rss | RSS 2.0 + Atom |
| wikipedia | Wikipedia | `#mw-content-text` extraction |
| bing serp | BingSerp | Organic `b_algo` results; redirect URL decode |
| youtube | YouTube | Metadata + optional transcript |
| outlook .msg | Outlook | `@kenjiuno/msgreader` |
| png, jpg | Image | Embedded + optional GGUF caption |
| zip | Zip | Recursive member conversion |
| docx | Docx | mammoth + OMML→LaTeX preprocess |
| xlsx, xls | Xlsx / Xls | SheetJS |
| pptx | Pptx | jszip + XML; optional GGUF image captions |
| wav, mp3, m4a | Audio | `music-metadata` tags |

### PKC format

Binary container: `PKC\x01` + uint32 length + gzip(JSON):

```json
{
  "version": 1,
  "title": "…",
  "markdown": "…",
  "source": "…",
  "createdAt": "…"
}
```

## Setup

```bash
npm install
npm run build
npm test
```

### Optional: GGUF peer dependency

```bash
# Desktop / iOS / Android / PWA
npm install llama-cpp-capacitor
```

Use this package from your host app:

```bash
npm install @annadata/pack-it-pkc
# local link while developing:
# npm install ../pack-it-pkc
```

```typescript
import { MarkItDown, generateStudyPkc } from "@annadata/pack-it-pkc";
import { CapacitorGgufProvider } from "@annadata/pack-it-pkc/inference/capacitor";
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build `dist/` |
| `npm run dev` | Watch mode |
| `npm test` | Vitest |
| `npm run test:manual` | Local convert / PDF / study PKC harness |

## License

MIT — Mr. Yakub Mohammad &lt;yakub@annadata.ai&gt;

PDF conversion uses [MuPDF.js](https://www.npmjs.com/package/mupdf) (AGPL-3.0). Distributing this library with PDF support requires complying with the AGPL; source distribution satisfies that for an open-source product.
