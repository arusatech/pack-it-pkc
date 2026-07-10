/**
 * Optional LLM assist: noisy OCR chemistry → mhchem \\ce{…}.
 * Uses GgufInferenceProvider (not LlamaService).
 */

import type { GgufInferenceProvider } from "../inference/types.js";
import { getActiveModelId, ensureModelReady } from "../inference/model-session.js";
import {
  extractCeFromLlmResponse,
  isLowConfidenceNormalization,
  plainChemistryToMhchem,
} from "./chemistry-normalize.js";

const CHEM_SYSTEM = [
  "You convert OCR chemistry equations to mhchem LaTeX.",
  "Reply with ONLY one line: \\ce{...}",
  "Use ^{2+} for ion charges, (aq)/(s)/(g)/(l) for states, -> for reaction arrows.",
  "Example: Zn(s) + Cu^{2+}(aq) -> Zn^{2+}(aq) + Cu(s)",
].join(" ");

export interface ChemistryLlmAssistOptions {
  /** When true, download/load the active chat model if needed (manual AI fix). */
  loadModelIfNeeded?: boolean;
  modelId?: string;
  onProgress?: (message: string) => void;
  onDownloadProgress?: (p: { loaded: number; total: number; percentage: number }) => void;
}

export async function llmPlainToMhchem(
  plain: string,
  provider: GgufInferenceProvider | null | undefined,
  opts: ChemistryLlmAssistOptions = {},
): Promise<string | null> {
  const trimmed = plain.trim();
  if (!trimmed) return null;
  if (!provider) return null;

  try {
    if (opts.loadModelIfNeeded) {
      opts.onProgress?.("Loading model for formula assist…");
      await ensureModelReady(provider, opts.modelId ?? getActiveModelId(), {
        onStatus: opts.onProgress,
        onProgress: opts.onDownloadProgress,
      });
    }

    opts.onProgress?.("Running AI formula assist…");
    const text = await provider.complete(
      [
        { role: "system", content: CHEM_SYSTEM },
        { role: "user", content: `OCR: ${trimmed.slice(0, 480)}` },
      ],
      { maxTokens: 160, temperature: 0.05 },
    );
    return extractCeFromLlmResponse(text.trim());
  } catch (e) {
    console.warn("[chemistryLlmAssist] failed", e);
    opts.onProgress?.(e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Rules first; optional LLM when confidence is low or loadModelIfNeeded is set. */
export async function normalizeChemistryWithAssist(
  plain: string,
  provider?: GgufInferenceProvider | null,
  opts: ChemistryLlmAssistOptions = {},
): Promise<string> {
  const ruled = plainChemistryToMhchem(plain);
  if (!opts.loadModelIfNeeded && !isLowConfidenceNormalization(plain, ruled)) {
    return ruled;
  }
  if (!provider) return ruled;

  const llm = await llmPlainToMhchem(plain, provider, opts);
  return llm ?? ruled;
}
