export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
}

export function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}
