import { defineConfig } from "tsup";

const external = [
  "mupdf",
  "katex",
  "katex/contrib/auto-render",
  "katex/contrib/mhchem",
  "file-type",
  "fflate",
  "mammoth",
  "xlsx",
  "jszip",
  "fast-xml-parser",
  "@kenjiuno/msgreader",
  "youtube-transcript-api-js",
  "music-metadata",
  "llama-cpp-pro",
  "@capacitor/filesystem",
  "chardet",
  "cheerio",
  "turndown",
  "flexsearch",
  "usearch",
];

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "inference/capacitor-provider": "src/inference/capacitor-provider.ts",
    "pdf/editor": "src/pdf/editor.ts",
    "assets/manifest": "src/assets/manifest.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external,
  esbuildOptions(options) {
    options.platform = "neutral";
  },
});
