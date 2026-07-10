/**
 * Optional LLM assist: noisy OCR math → KaTeX LaTeX.
 * Uses GgufInferenceProvider (not LlamaService).
 */

import type { GgufInferenceProvider } from "../inference/types.js";
import { getActiveModelId, ensureModelReady } from "../inference/model-session.js";
import {
  extractLatexFromLlmResponse,
  isLowConfidenceMathNormalization,
  plainMathToLatex,
} from "./math-normalize.js";

const MATH_SYSTEM = [
  "You convert OCR mathematics to KaTeX LaTeX.",
  "Reply with ONLY one math expression wrapped in $...$ or $$...$$ for display math.",
  "Use \\frac{a}{b}, ^{2}, _{n}, \\sqrt{x}, \\int, \\sum, \\pi, \\alpha, etc.",
  "Example: $x^{2} + y^{2} = r^{2}$",
].join(" ");

export interface MathLlmAssistOptions {
  loadModelIfNeeded?: boolean;
  modelId?: string;
  onProgress?: (message: string) => void;
  onDownloadProgress?: (p: { loaded: number; total: number; percentage: number }) => void;
}

export async function llmPlainToLatex(
  plain: string,
  provider: GgufInferenceProvider | null | undefined,
  opts: MathLlmAssistOptions = {},
): Promise<string | null> {
  const trimmed = plain.trim();
  if (!trimmed) return null;
  if (!provider) return null;

  try {
    if (opts.loadModelIfNeeded) {
      opts.onProgress?.("Loading model for math assist…");
      await ensureModelReady(provider, opts.modelId ?? getActiveModelId(), {
        onStatus: opts.onProgress,
        onProgress: opts.onDownloadProgress,
      });
    }

    opts.onProgress?.("Running AI math assist…");
    const text = await provider.complete(
      [
        { role: "system", content: MATH_SYSTEM },
        { role: "user", content: `OCR: ${trimmed.slice(0, 480)}` },
      ],
      { maxTokens: 200, temperature: 0.05 },
    );
    return extractLatexFromLlmResponse(text.trim());
  } catch (e) {
    console.warn("[mathLlmAssist] failed", e);
    opts.onProgress?.(e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function normalizeMathWithAssist(
  plain: string,
  provider?: GgufInferenceProvider | null,
  opts: MathLlmAssistOptions = {},
): Promise<string> {
  const display = plain.includes("\n") || plain.length > 60;
  const ruled = plainMathToLatex(plain, display);
  if (!opts.loadModelIfNeeded && !isLowConfidenceMathNormalization(plain, ruled)) {
    return ruled;
  }
  if (!provider) return ruled;

  const llm = await llmPlainToLatex(plain, provider, opts);
  return llm ?? ruled;
}
