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
  "llama-cpp-capacitor",
  "@capacitor/filesystem",
  "chardet",
  "cheerio",
  "turndown",
];

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "inference/capacitor-provider": "src/inference/capacitor-provider.ts",
    "pdf/editor": "src/pdf/editor.ts",
    "assets/manifest": "src/assets/manifest.ts",
  },
  format: ["esm", "cjs"],
  dts: {
    // tsup injects baseUrl: "." during DTS bundling (tsup#1388); TS 6.0 deprecates baseUrl.
    compilerOptions: {
      ignoreDeprecations: "6.0",
    },
  },
  clean: true,
  external,
  esbuildOptions(options) {
    options.platform = "neutral";
  },
});
