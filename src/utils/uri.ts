export function parseDataUri(uri: string): {
  mimetype: string;
  attributes: Record<string, string>;
  data: Uint8Array;
} {
  const match = /^data:([^;,]+)?((?:;[^;,]+)*)?,(.*)$/s.exec(uri);
  if (!match) throw new Error(`Invalid data URI: ${uri.slice(0, 64)}…`);

  const mimetype = match[1] || "text/plain";
  const attrPart = match[2] || "";
  const payload = match[3];

  const attributes: Record<string, string> = {};
  for (const part of attrPart.split(";").filter(Boolean)) {
    const [k, v] = part.split("=");
    if (k && v) attributes[k.toLowerCase()] = v;
  }

  const isBase64 = attributes["base64"] !== undefined || attrPart.includes(";base64");
  let data: Uint8Array;
  if (isBase64) {
    const binary = atob(payload);
    data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  } else {
    data = new TextEncoder().encode(decodeURIComponent(payload));
  }

  return { mimetype, attributes, data };
}

export function fileUriToPath(uri: string): { netloc: string; path: string } {
  const parsed = new URL(uri);
  return { netloc: parsed.hostname, path: decodeURIComponent(parsed.pathname) };
}
