/**
 * Download GGUF models to OPFS (browser) or ~/.cache/pack-it-pkc/models (Node).
 * No dependency on llama-cpp-capacitor.
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
};

const MODELS_DIR = "models";
const MANIFEST_NAME = "manifest.json";
const NODE_CACHE_DIR = "pack-it-pkc/models";

type ManifestMap = Record<string, DownloadedModelInfo>;

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

// ── Node filesystem ─────────────────────────────────────────────────────────

async function nodeCacheDir(): Promise<string> {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { mkdir } = await import("node:fs/promises");
  const dir = join(homedir(), ".cache", NODE_CACHE_DIR);
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
): Promise<DownloadedModelInfo> {
  const { join } = await import("node:path");
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");

  const manifest = await readNodeManifest();
  const existing = manifest[modelId];
  if (existing) {
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
  const path = join(dir, `${sanitizeModelId(modelId)}.gguf`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const fileStream = createWriteStream(path);
  let written = 0;

  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
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
  manifest[modelId] = entry;
  await writeNodeManifest(manifest);
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

  if (isBrowserOpfsAvailable()) {
    return downloadToOpfs(modelId, url, options.onProgress);
  }
  if (isNodeRuntime()) {
    return downloadToNode(modelId, url, options.onProgress);
  }
  throw new Error("downloadModel requires a browser with OPFS or a Node.js runtime.");
}

/** Snake_case alias for apps that prefer download_model(). */
export const download_model = downloadModel;

export async function isModelDownloaded(modelId: string): Promise<boolean> {
  const path = await getModelLocalPath(modelId);
  return path != null;
}

export async function listDownloadedModels(): Promise<DownloadedModelInfo[]> {
  if (isBrowserOpfsAvailable()) {
    return Object.values(await readOpfsManifest());
  }
  if (isNodeRuntime()) {
    return Object.values(await readNodeManifest());
  }
  return [];
}

export async function getModelLocalPath(modelId: string): Promise<string | null> {
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
  if (isBrowserOpfsAvailable()) {
    await deleteFromOpfs(modelId);
    return;
  }
  if (isNodeRuntime()) {
    await deleteFromNode(modelId);
  }
}
