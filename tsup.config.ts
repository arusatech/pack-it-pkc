import { defineConfig } from "tsup";

const external = [
  "mupdf",
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
  "node-llama-cpp",
];

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/inference/capacitor-provider.ts",
    "src/inference/node-provider.ts",
  ],
  format: ["esm", "cjs"],
  dts: {
    // tsup injects baseUrl: "." during DTS bundling (tsup#1388); TS 6.0 deprecates baseUrl.
    compilerOptions: {
      ignoreDeprecations: "6.0",
    },
  },
  clean: true,
  external,
});
