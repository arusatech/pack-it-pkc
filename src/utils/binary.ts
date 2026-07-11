/** Binary helpers that work in browser, Capacitor, and Node without assuming Buffer. */

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

/** Decode base64url (padding optional). */
export function decodeBase64Url(input: string): string {
  const cleaned = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (cleaned.length % 4)) % 4;
  const padded = cleaned + "=".repeat(padLen);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf-8");
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return utf8Decode(bytes);
}

/** Prefer Uint8Array; fall back to Buffer when a Node-only API requires it. */
export function toBuffer(bytes: Uint8Array): Uint8Array | Buffer {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes);
  return bytes;
}
