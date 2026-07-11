/** Path helpers without node:path (browser-safe). */

export function basename(filename: string): string {
  const normalized = filename.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filename;
}

export function extname(filename: string): string {
  const base = basename(filename);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}
