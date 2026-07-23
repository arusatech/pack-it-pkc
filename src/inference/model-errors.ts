/**
 * Human-readable reasons when GGUF download / load fails or is skipped.
 */

import { getModelById, LFM2_CHAT_MODEL_ID } from "./model-catalog.js";

/** Map raw errors (disk, memory, network, timeout) to a kind user message. */
export function explainModelFailure(
  modelId: string,
  err: unknown,
  phase: "download" | "load" | "timeout" | "skip" = "load",
): string {
  const raw = err instanceof Error ? err.message : String(err ?? "unknown error");
  const lower = raw.toLowerCase();
  const entry = getModelById(modelId);
  const sizeHint = entry?.sizeMB
    ? ` This model is about ${Math.round(entry.sizeMB)} MB.`
    : modelId === LFM2_CHAT_MODEL_ID
      ? " This chat model is about 700 MB."
      : "";

  if (phase === "skip") {
    return (
      `Skipped loading ${modelId} so Generate Study PKC can finish quickly.` +
      sizeHint +
      " Flashcards use rule-based answers. Free disk/RAM and load the model from the model picker if you want AI-assisted cards."
    );
  }

  if (
    /enospc|no space|not enough space|quotaexceeded|quota exceeded|storage.*full|disk.*(full|space)|out of (disk|storage)/i.test(
      lower,
    ) ||
    /domexception.*(quota|22)/i.test(lower)
  ) {
    return (
      `Not enough disk (or browser storage) space to ${phase} ${modelId}.` +
      sizeHint +
      " Free space, clear old models, then try again. Details: " +
      raw
    );
  }

  if (
    /out of memory|oom|cannot allocate|memory (limit|pressure)|wasm.*memory|array buffer allocation failed|failed to allocate/i.test(
      lower,
    )
  ) {
    return (
      `Not enough memory (RAM) to load ${modelId}.` +
      sizeHint +
      " Close other tabs/apps, try a smaller device, or skip AI load for Study PKC. Details: " +
      raw
    );
  }

  if (/timed out|timeout/i.test(lower)) {
    return (
      `Loading ${modelId} timed out.` +
      sizeHint +
      " Common causes: slow device, low RAM, or the model file is still downloading. Study PKC continues with rule-based flashcards. Details: " +
      raw
    );
  }

  if (
    /network|fetch failed|failed to fetch|net::|econnreset|enotfound|offline|503|502|500|404/i.test(
      lower,
    )
  ) {
    return (
      `Could not download ${modelId} (network error).` +
      sizeHint +
      " Check your connection and try again. Details: " +
      raw
    );
  }

  if (/corrupt|invalid|gguf|magic|truncated|unexpected end|incomplete/i.test(lower)) {
    return (
      `Model file for ${modelId} looks incomplete or corrupt.` +
      " Delete it from the model list and download again. Details: " +
      raw
    );
  }

  if (phase === "download") {
    return `Could not download ${modelId}.${sizeHint} ${raw}`;
  }

  return (
    `Could not load ${modelId}.` +
    sizeHint +
    " Possible causes: low disk space, low RAM, or a partial download. Details: " +
    raw
  );
}
