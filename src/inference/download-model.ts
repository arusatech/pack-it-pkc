/**
 * Download GGUF models to:
 * - Electron: `<os.tmpdir()>/AcharyaAnnadata/models` via `window.acharyaFs`
 * - Node: same tmpdir path
 * - Capacitor native: `@capacitor/filesystem` Data dir (or `targetPath`)
 * - Browser PWA: OPFS
 */

import { getModelById, modelUrlForId } from "./model-catalog.js";

export type DownloadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};

export type DownloadedModelInfo = {
  modelId: string;
  path: string;
  sizeBytes: number;
  sourceUrl?: string;
  createdAt: number;
  lastUsedAt: number;
};

export type DownloadModelOptions = {
  onProgress?: (progress: DownloadProgress) => void;
  /** Override catalog URL if the app wants a custom GGUF. */
  url?: string;
  /**
   * Storage backend. `auto` picks Electron Acharya FS, OPFS, Capacitor, or Node.
   * Hosts can force a backend or pass `targetPath` for a custom file.
   */
  storage?: "auto" | "opfs" | "capacitor" | "node" | "acharya";
  /**
   * Absolute native path (or Capacitor URI) for the GGUF file.
   * When set, download writes here and returns this path for `loadModel`.
   */
  targetPath?: string;
};

const MODELS_DIR = "models";
const MANIFEST_NAME = "manifest.json";
/** Folder name under OS temp — shared by Electron + Node downloads. */
export const ACHARYA_DOWNLOADS_DIR_NAME = "AcharyaAnnadata";

type ManifestMap = Record<string, DownloadedModelInfo>;

type AcharyaFsBridge = {
  getRootDir: () => Promise<string>;
  exists: (relativePath: string) => Promise<boolean>;
  readText: (relativePath: string) => Promise<string | null>;
  writeText: (relativePath: string, text: string) => Promise<void>;
  unlink: (relativePath: string) => Promise<void>;
  downloadUrl: (
    url: string,
    relativePath: string,
    onProgress?: (progress: DownloadProgress) => void,
  ) => Promise<{ path: string; sizeBytes: number }>;
};

function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function pathForModelId(modelId: string): string {
  return `${MODELS_DIR}/${sanitizeModelId(modelId)}.gguf`;
}

function isBrowserOpfsAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && !!process.versions?.node;
}

function isCapacitorNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === "function" && cap.isNativePlatform();
}

/** Electron (or host) bridge that writes under `<tmpdir>/AcharyaAnnadata/`. */
export function getAcharyaFsBridge(): AcharyaFsBridge | null {
  const bridge = (globalThis as { acharyaFs?: AcharyaFsBridge }).acharyaFs;
  if (!bridge || typeof bridge.getRootDir !== "function" || typeof bridge.downloadUrl !== "function") {
    return null;
  }
  return bridge;
}

/** Absolute downloads root when Electron bridge or Node APIs are available. */
export async function getAcharyaDownloadsRoot(): Promise<string> {
  const bridge = getAcharyaFsBridge();
  if (bridge) return bridge.getRootDir();
  if (isNodeRuntime()) {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { mkdir } = await import("node:fs/promises");
    const root =
      process.platform === "win32"
        ? join(tmpdir(), ACHARYA_DOWNLOADS_DIR_NAME)
        : join("/tmp", ACHARYA_DOWNLOADS_DIR_NAME);
    await mkdir(root, { recursive: true });
    return root;
  }
  throw new Error("Acharya downloads root requires Electron acharyaFs or Node.js.");
}

type CapacitorFilesystem = {
  Directory: { Data: string; [key: string]: string };
  Encoding?: { UTF8: string };
  writeFile: (opts: {
    path: string;
    data: string;
    directory: string;
    recursive?: boolean;
  }) => Promise<{ uri?: string } | void>;
  readFile: (opts: { path: string; directory: string; encoding?: string }) => Promise<{ data: string }>;
  deleteFile: (opts: { path: string; directory: string }) => Promise<void>;
  mkdir: (opts: { path: string; directory: string; recursive?: boolean }) => Promise<void>;
  getUri: (opts: { path: string; directory: string }) => Promise<{ uri: string }>;
};

async function tryLoadCapacitorFilesystem(): Promise<CapacitorFilesystem | null> {
  try {
    const mod = "@capacitor/filesystem";
    const fs = await import(/* @vite-ignore */ mod);
    return (fs.Filesystem ?? fs.default ?? null) as CapacitorFilesystem | null;
  } catch {
    return null;
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

async function writeStreamToSink(
  res: Response,
  writeChunk: (chunk: Uint8Array) => Promise<void>,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<number> {
  const total = Number(res.headers.get("content-length") ?? 0);
  let written = 0;

  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    await writeChunk(buf);
    written = buf.byteLength;
    onProgress?.({ loaded: written, total: total || written, percentage: 100 });
    return written;
  }

  const reader = res.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      await writeChunk(value);
      written += value.byteLength;
      const pct = total ? Math.min(100, Math.round((written / total) * 100)) : 0;
      onProgress?.({ loaded: written, total: total || written, percentage: pct });
    }
  }
  if (total) onProgress?.({ loaded: written, total, percentage: 100 });
  return written;
}

// ── Electron Acharya FS (`<tmpdir>/AcharyaAnnadata`) ────────────────────────

async function readAcharyaManifest(fs: AcharyaFsBridge): Promise<ManifestMap> {
  try {
    const text = await fs.readText(`${MODELS_DIR}/${MANIFEST_NAME}`);
    if (!text?.trim()) return {};
    return JSON.parse(text) as ManifestMap;
  } catch {
    return {};
  }
}

async function writeAcharyaManifest(fs: AcharyaFsBridge, map: ManifestMap): Promise<void> {
  await fs.writeText(`${MODELS_DIR}/${MANIFEST_NAME}`, JSON.stringify(map, null, 2));
}

async function downloadToAcharyaFs(
  modelId: string,
  modelUrl: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<DownloadedModelInfo> {
  const fs = getAcharyaFsBridge();
  if (!fs) throw new Error("acharyaFs bridge is not available");

  const relativePath = pathForModelId(modelId);
  const manifest = await readAcharyaManifest(fs);
  const existing = manifest[modelId];
  if (existing && (await fs.exists(relativePath))) {
    const updated = { ...existing, lastUsedAt: Date.now() };
    manifest[modelId] = updated;
    await writeAcharyaManifest(fs, manifest);
    onProgress?.({
      loaded: existing.sizeBytes,
      total: existing.sizeBytes,
      percentage: 100,
    });
    return updated;
  }

  const { path, sizeBytes } = await fs.downloadUrl(modelUrl, relativePath, onProgress);
  const now = Date.now();
  const entry: DownloadedModelInfo = {
    modelId,
    path,
    sizeBytes,
    sourceUrl: modelUrl,
    createdAt: now,
    lastUsedAt: now,
  };
  manifest[modelId] = entry;
  await writeAcharyaManifest(fs, manifest);
  return entry;
}

async function deleteFromAcharyaFs(modelId: string): Promise<void> {
  const fs = getAcharyaFsBridge();
  if (!fs) return;
  const manifest = await readAcharyaManifest(fs);
  if (!manifest[modelId]) return;
  await fs.unlink(pathForModelId(modelId)).catch(() => undefined);
  delete manifest[modelId];
  await writeAcharyaManifest(fs, manifest);
}

// ── Browser OPFS ────────────────────────────────────────────────────────────

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  const storage = navigator.storage;
  if (!storage?.getDirectory) {
    throw new Error("OPFS is not available (navigator.storage.getDirectory missing).");
  }
  return storage.getDirectory();
}

async function ensureOpfsFileHandle(path: string): Promise<FileSystemFileHandle> {
  const root = await getOpfsRoot();
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error(`Invalid OPFS path '${path}'.`);
  let current: FileSystemDirectoryHandle = root;
  for (const dir of parts) {
    current = await current.getDirectoryHandle(dir, { create: true });
  }
  return current.getFileHandle(fileName, { create: true });
}

async function readOpfsManifest(): Promise<ManifestMap> {
  try {
    const root = await getOpfsRoot();
    const dir = await root.getDirectoryHandle(MODELS_DIR, { create: true });
    const file = await dir.getFileHandle(MANIFEST_NAME, { create: true });
    const text = await (await file.getFile()).text();
    if (!text.trim()) return {};
    return JSON.parse(text) as ManifestMap;
  } catch {
    return {};
  }
}

async function writeOpfsManifest(map: ManifestMap): Promise<void> {
  const root = await getOpfsRoot();
  const dir = await root.getDirectoryHandle(MODELS_DIR, { create: true });
  const file = await dir.getFileHandle(MANIFEST_NAME, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(JSON.stringify(map, null, 2));
  } finally {
    await writable.close();
  }
}

async function downloadToOpfs(
  modelId: string,
  modelUrl: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<DownloadedModelInfo> {
  const manifest = await readOpfsManifest();
  const existing = manifest[modelId];
  if (existing) {
    const updated = { ...existing, lastUsedAt: Date.now() };
    manifest[modelId] = updated;
    await writeOpfsManifest(manifest);
    onProgress?.({
      loaded: existing.sizeBytes,
      total: existing.sizeBytes,
      percentage: 100,
    });
    return updated;
  }

  let res: Response;
  try {
    res = await fetch(modelUrl);
  } catch (error) {
    throw new Error(`Failed to download model '${modelId}': ${String(error)}`);
  }
  if (!res.ok) {
    throw new Error(`Failed to download model '${modelId}': HTTP ${res.status}`);
  }

  const path = pathForModelId(modelId);
  const fileHandle = await ensureOpfsFileHandle(path);
  const writable = await fileHandle.createWritable();
  let sizeBytes = 0;
  try {
    sizeBytes = await writeStreamToSink(
      res,
      async (chunk) => {
        const copy = new Uint8Array(chunk.byteLength);
        copy.set(chunk);
        await writable.write(copy);
      },
      onProgress,
    );
  } finally {
    await writable.close();
  }

  const now = Date.now();
  const entry: DownloadedModelInfo = {
    modelId,
    path,
    sizeBytes,
    sourceUrl: modelUrl,
    createdAt: now,
    lastUsedAt: now,
  };
  manifest[modelId] = entry;
  await writeOpfsManifest(manifest);
  return entry;
}

async function deleteFromOpfs(modelId: string): Promise<void> {
  const manifest = await readOpfsManifest();
  const entry = manifest[modelId];
  if (!entry) return;
  try {
    const root = await getOpfsRoot();
    const parts = entry.path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (fileName) {
      let current: FileSystemDirectoryHandle = root;
      for (const dir of parts) {
        current = await current.getDirectoryHandle(dir);
      }
      await current.removeEntry(fileName);
    }
  } catch {
    /* file may already be gone */
  }
  delete manifest[modelId];
  await writeOpfsManifest(manifest);
}

// ── Capacitor Filesystem (native iOS / Android / desktop hosts) ──────────────

async function capacitorManifestPath(): Promise<string> {
  return `${MODELS_DIR}/${MANIFEST_NAME}`;
}

async function readCapacitorManifest(fs: CapacitorFilesystem): Promise<ManifestMap> {
  try {
    const result = await fs.readFile({
      path: await capacitorManifestPath(),
      directory: fs.Directory.Data,
      encoding: fs.Encoding?.UTF8,
    });
    const text = typeof result.data === "string" ? result.data : "";
    if (!text.trim()) return {};
    return JSON.parse(text) as ManifestMap;
  } catch {
    return {};
  }
}

async function writeCapacitorManifest(fs: CapacitorFilesystem, map: ManifestMap): Promise<void> {
  await fs.mkdir({ path: MODELS_DIR, directory: fs.Directory.Data, recursive: true }).catch(() => undefined);
  await fs.writeFile({
    path: await capacitorManifestPath(),
    data: JSON.stringify(map, null, 2),
    directory: fs.Directory.Data,
    recursive: true,
  });
}

async function downloadToCapacitor(
  modelId: string,
  modelUrl: string,
  onProgress?: (progress: DownloadProgress) => void,
  targetPath?: string,
): Promise<DownloadedModelInfo> {
  const fs = await tryLoadCapacitorFilesystem();
  if (!fs) {
    throw new Error(
      "Capacitor Filesystem unavailable. Install @capacitor/filesystem or pass options.targetPath from the host app.",
    );
  }

  const manifest = await readCapacitorManifest(fs);
  const existing = manifest[modelId];
  if (existing && !targetPath) {
    const updated = { ...existing, lastUsedAt: Date.now() };
    manifest[modelId] = updated;
    await writeCapacitorManifest(fs, manifest);
    onProgress?.({
      loaded: existing.sizeBytes,
      total: existing.sizeBytes,
      percentage: 100,
    });
    return updated;
  }

  let res: Response;
  try {
    res = await fetch(modelUrl);
  } catch (error) {
    throw new Error(`Failed to download model '${modelId}': ${String(error)}`);
  }
  if (!res.ok) {
    throw new Error(`Failed to download model '${modelId}': HTTP ${res.status}`);
  }

  const relativePath = targetPath ?? pathForModelId(modelId);
  const chunks: Uint8Array[] = [];
  const sizeBytes = await writeStreamToSink(
    res,
    async (chunk) => {
      chunks.push(chunk.slice());
    },
    onProgress,
  );
  const merged = new Uint8Array(sizeBytes);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }

  await fs.mkdir({ path: MODELS_DIR, directory: fs.Directory.Data, recursive: true }).catch(() => undefined);
  await fs.writeFile({
    path: relativePath,
    data: uint8ToBase64(merged),
    directory: fs.Directory.Data,
    recursive: true,
  });

  let uri = relativePath;
  try {
    const resolved = await fs.getUri({ path: relativePath, directory: fs.Directory.Data });
    if (resolved?.uri) uri = resolved.uri;
  } catch {
    /* keep relative path */
  }

  const now = Date.now();
  const entry: DownloadedModelInfo = {
    modelId,
    path: uri,
    sizeBytes,
    sourceUrl: modelUrl,
    createdAt: now,
    lastUsedAt: now,
  };
  if (!targetPath) {
    manifest[modelId] = entry;
    await writeCapacitorManifest(fs, manifest);
  }
  return entry;
}

async function deleteFromCapacitor(modelId: string): Promise<void> {
  const fs = await tryLoadCapacitorFilesystem();
  if (!fs) return;
  const manifest = await readCapacitorManifest(fs);
  if (!manifest[modelId]) return;
  try {
    await fs.deleteFile({ path: pathForModelId(modelId), directory: fs.Directory.Data });
  } catch {
    /* ignore */
  }
  delete manifest[modelId];
  await writeCapacitorManifest(fs, manifest);
}

// ── Node filesystem → `<tmpdir>/AcharyaAnnadata/models` ─────────────────────

async function nodeCacheDir(): Promise<string> {
  const { join } = await import("node:path");
  const { mkdir } = await import("node:fs/promises");
  const dir = join(await getAcharyaDownloadsRoot(), MODELS_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function nodeManifestPath(): Promise<string> {
  const { join } = await import("node:path");
  return join(await nodeCacheDir(), MANIFEST_NAME);
}

async function readNodeManifest(): Promise<ManifestMap> {
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(await nodeManifestPath(), "utf8");
    return JSON.parse(text) as ManifestMap;
  } catch {
    return {};
  }
}

async function writeNodeManifest(map: ManifestMap): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(await nodeManifestPath(), JSON.stringify(map, null, 2), "utf8");
}

async function downloadToNode(
  modelId: string,
  modelUrl: string,
  onProgress?: (progress: DownloadProgress) => void,
  targetPath?: string,
): Promise<DownloadedModelInfo> {
  const { join, dirname } = await import("node:path");
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");
  const { mkdir } = await import("node:fs/promises");

  const manifest = await readNodeManifest();
  const existing = manifest[modelId];
  if (existing && !targetPath) {
    const updated = { ...existing, lastUsedAt: Date.now() };
    manifest[modelId] = updated;
    await writeNodeManifest(manifest);
    onProgress?.({
      loaded: existing.sizeBytes,
      total: existing.sizeBytes,
      percentage: 100,
    });
    return updated;
  }

  let res: Response;
  try {
    res = await fetch(modelUrl);
  } catch (error) {
    throw new Error(`Failed to download model '${modelId}': ${String(error)}`);
  }
  if (!res.ok) {
    throw new Error(`Failed to download model '${modelId}': HTTP ${res.status}`);
  }

  const dir = await nodeCacheDir();
  const path = targetPath ?? join(dir, `${sanitizeModelId(modelId)}.gguf`);
  await mkdir(dirname(path), { recursive: true });
  const total = Number(res.headers.get("content-length") ?? 0);
  const fileStream = createWriteStream(path);
  let written = 0;

  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    await new Promise<void>((resolve, reject) => {
      fileStream.write(buf, (err) => (err ? reject(err) : resolve()));
    });
    written = buf.byteLength;
    await new Promise<void>((resolve, reject) => {
      fileStream.end(() => resolve());
      fileStream.on("error", reject);
    });
  } else {
    const nodeReadable = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
    nodeReadable.on("data", (chunk: Buffer) => {
      written += chunk.length;
      const pct = total ? Math.min(100, Math.round((written / total) * 100)) : 0;
      onProgress?.({ loaded: written, total: total || written, percentage: pct });
    });
    await pipeline(nodeReadable, fileStream);
  }

  onProgress?.({ loaded: written, total: total || written, percentage: 100 });

  const now = Date.now();
  const entry: DownloadedModelInfo = {
    modelId,
    path,
    sizeBytes: written,
    sourceUrl: modelUrl,
    createdAt: now,
    lastUsedAt: now,
  };
  if (!targetPath) {
    manifest[modelId] = entry;
    await writeNodeManifest(manifest);
  }
  return entry;
}

async function deleteFromNode(modelId: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  const manifest = await readNodeManifest();
  const entry = manifest[modelId];
  if (!entry) return;
  try {
    await unlink(entry.path);
  } catch {
    /* ignore */
  }
  delete manifest[modelId];
  await writeNodeManifest(manifest);
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Download (or no-op if cached) a catalog / custom GGUF model. */
export async function downloadModel(
  modelId: string,
  options: DownloadModelOptions = {},
): Promise<DownloadedModelInfo> {
  if (!modelId) throw new Error("modelId is required for download.");

  const url = options.url ?? modelUrlForId(modelId);
  if (!url) {
    const known = getModelById(modelId);
    throw new Error(
      known
        ? `Model '${modelId}' has no download URL.`
        : `Unknown model '${modelId}'. Pass options.url or use a catalog id.`,
    );
  }

  const storage = options.storage ?? "auto";
  const bridge = getAcharyaFsBridge();
  const preferAcharya = storage === "acharya" || (storage === "auto" && !!bridge);
  const preferOpfs =
    storage === "opfs" ||
    (storage === "auto" && !bridge && isBrowserOpfsAvailable() && !isCapacitorNative());
  const preferCapacitor =
    storage === "capacitor" ||
    (storage === "auto" && !bridge && isCapacitorNative()) ||
    (storage === "auto" && !!options.targetPath && !isNodeRuntime() && !preferOpfs && !bridge);
  const preferNode = storage === "node" || (storage === "auto" && isNodeRuntime() && !bridge);

  if (preferAcharya && bridge) {
    return downloadToAcharyaFs(modelId, url, options.onProgress);
  }
  if (preferOpfs && isBrowserOpfsAvailable()) {
    return downloadToOpfs(modelId, url, options.onProgress);
  }
  if (
    preferCapacitor ||
    (storage === "auto" && !isNodeRuntime() && !bridge && (await tryLoadCapacitorFilesystem()))
  ) {
    return downloadToCapacitor(modelId, url, options.onProgress, options.targetPath);
  }
  if (preferNode && isNodeRuntime()) {
    return downloadToNode(modelId, url, options.onProgress, options.targetPath);
  }
  if (bridge) {
    return downloadToAcharyaFs(modelId, url, options.onProgress);
  }
  if (isBrowserOpfsAvailable()) {
    return downloadToOpfs(modelId, url, options.onProgress);
  }
  if (isNodeRuntime()) {
    return downloadToNode(modelId, url, options.onProgress, options.targetPath);
  }
  throw new Error(
    "downloadModel requires Electron acharyaFs, OPFS (PWA), @capacitor/filesystem, or Node.js.",
  );
}

/** Snake_case alias for apps that prefer download_model(). */
export const download_model = downloadModel;

export async function isModelDownloaded(modelId: string): Promise<boolean> {
  const path = await getModelLocalPath(modelId);
  return path != null;
}

export async function listDownloadedModels(): Promise<DownloadedModelInfo[]> {
  const bridge = getAcharyaFsBridge();
  if (bridge) return Object.values(await readAcharyaManifest(bridge));
  if (isCapacitorNative()) {
    const fs = await tryLoadCapacitorFilesystem();
    if (fs) return Object.values(await readCapacitorManifest(fs));
  }
  if (isBrowserOpfsAvailable()) {
    return Object.values(await readOpfsManifest());
  }
  if (isNodeRuntime()) {
    return Object.values(await readNodeManifest());
  }
  return [];
}

export async function getModelLocalPath(modelId: string): Promise<string | null> {
  const bridge = getAcharyaFsBridge();
  if (bridge) {
    const entry = (await readAcharyaManifest(bridge))[modelId];
    return entry?.path ?? null;
  }
  if (isCapacitorNative()) {
    const fs = await tryLoadCapacitorFilesystem();
    if (fs) {
      const entry = (await readCapacitorManifest(fs))[modelId];
      if (entry?.path) return entry.path;
    }
  }
  if (isBrowserOpfsAvailable()) {
    const entry = (await readOpfsManifest())[modelId];
    return entry?.path ?? null;
  }
  if (isNodeRuntime()) {
    const entry = (await readNodeManifest())[modelId];
    return entry?.path ?? null;
  }
  return null;
}

export async function deleteModel(modelId: string): Promise<void> {
  if (getAcharyaFsBridge()) {
    await deleteFromAcharyaFs(modelId);
    return;
  }
  if (isCapacitorNative()) {
    await deleteFromCapacitor(modelId);
    return;
  }
  if (isBrowserOpfsAvailable()) {
    await deleteFromOpfs(modelId);
    return;
  }
  if (isNodeRuntime()) {
    await deleteFromNode(modelId);
  }
}
