import type {
  StudyGame,
  StudyGameAsset,
  StudyGameModule,
  StudyGameSpec,
} from "../study-types.js";

export const STUDY_GAME_MODULE_VERSION = 1 as const;

/** Soft limit for assembled document size (bytes, UTF-8). */
export const STUDY_GAME_MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export type AssembleGameDocumentOptions = {
  title?: string;
  config?: Record<string, unknown>;
  kind?: string;
  id?: string;
};

function escapeForScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function assetToDataUrl(asset: StudyGameAsset): string {
  const data = asset.data.trim();
  if (data.startsWith("data:")) return data;
  return `data:${asset.mimeType};base64,${data}`;
}

function buildAssetMap(assets: StudyGameAsset[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const asset of assets ?? []) {
    if (!asset?.id) continue;
    map[asset.id] = assetToDataUrl(asset);
  }
  return map;
}

/**
 * Upgrade legacy `player.html` → `module.documentHtml` and ensure arrays exist.
 */
export function normalizeStudyGame(game: StudyGame): StudyGame {
  const out: StudyGame = { ...game };
  if (!out.kind) out.kind = "custom";
  if (!out.id) out.id = `game-${Math.random().toString(36).slice(2, 9)}`;

  if (!out.module && out.player?.html) {
    out.module = {
      version: out.player.version ?? STUDY_GAME_MODULE_VERSION,
      documentHtml: out.player.html,
    };
  }

  if (out.module) {
    out.module = {
      ...out.module,
      version: out.module.version ?? STUDY_GAME_MODULE_VERSION,
    };
  }

  if (out.kind === "chess") {
    const chess = out as StudyGame & {
      fen?: string;
      pgn?: string;
      playerColor?: string;
      difficulty?: number;
      mode?: string;
    };
    out.config = {
      fen: chess.fen,
      pgn: chess.pgn,
      playerColor: chess.playerColor ?? "w",
      difficulty: chess.difficulty ?? 3,
      mode: chess.mode ?? "play",
      ...(out.config ?? {}),
    };
  }

  return out;
}

export function normalizeStudyGames(games: StudyGame[] | undefined): StudyGame[] {
  if (!Array.isArray(games)) return [];
  return games.map(normalizeStudyGame);
}

/**
 * Stitch module parts into a single HTML document for sandboxed iframe mount.
 * Prefer `documentHtml` when present (first-party chess bundles).
 */
export function assembleGameDocument(
  module: StudyGameModule,
  options: AssembleGameDocumentOptions = {},
): string {
  const title = options.title ?? "Game";
  const boot = {
    kind: options.kind ?? "custom",
    id: options.id ?? "game",
    title,
    config: options.config ?? {},
    assets: buildAssetMap(module.assets),
  };

  if (module.documentHtml?.trim()) {
    const doc = module.documentHtml.trim();
    // Self-contained documents (chess, etc.) already boot themselves — do not
    // inject a second script that can disturb parsing or duplicate globals.
    if (
      doc.includes("__PKC_GAME__") ||
      doc.includes("__PKC_CHESS__") ||
      /<script[\s>]/i.test(doc)
    ) {
      return doc;
    }
    const inject = `<script>window.__PKC_GAME__=${escapeForScriptJson(boot)};</script>`;
    if (/<\/head>/i.test(doc)) return doc.replace(/<\/head>/i, `${inject}</head>`);
    if (/<body[^>]*>/i.test(doc)) {
      return doc.replace(/<body([^>]*)>/i, `<body$1>${inject}`);
    }
    return `${inject}${doc}`;
  }

  const css = module.css?.trim() ?? "";
  const body = module.html?.trim() ?? `<div id="app"></div>`;
  const js = module.js?.trim() ?? "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtmlText(title)}</title>
${css ? `<style>\n${css}\n</style>` : ""}
</head>
<body>
${body}
<script>window.__PKC_GAME__=${escapeForScriptJson(boot)};</script>
${js ? `<script>\n${js}\n</script>` : ""}
</body>
</html>`;

  if (new TextEncoder().encode(html).byteLength > STUDY_GAME_MAX_DOCUMENT_BYTES) {
    throw new Error(
      `Assembled game document exceeds ${STUDY_GAME_MAX_DOCUMENT_BYTES} bytes`,
    );
  }
  return html;
}

/**
 * Resolve a playable HTML document from any StudyGame (module or legacy player).
 * Returns null when the cartridge has no executable UI.
 */
export function resolvePlayableGameHtml(game: StudyGameSpec): string | null {
  const normalized = normalizeStudyGame(game);
  const mod = normalized.module;
  if (!mod) return null;
  if (!mod.documentHtml?.trim() && !mod.html?.trim() && !mod.js?.trim()) {
    return null;
  }
  return assembleGameDocument(mod, {
    title: normalized.title,
    config: normalized.config,
    kind: normalized.kind,
    id: normalized.id,
  });
}

/** True when the game can be mounted by the host loader. */
export function isPlayableStudyGame(game: StudyGame | null | undefined): boolean {
  if (!game) return false;
  return resolvePlayableGameHtml(game) != null;
}
