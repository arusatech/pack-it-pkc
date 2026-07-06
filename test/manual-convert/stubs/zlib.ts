import { gzipSync as fflateGzip, gunzipSync as fflateGunzip } from "fflate";

export function gzipSync(data: Uint8Array | Buffer): Buffer {
  const input = data instanceof Uint8Array ? data : new Uint8Array(data);
  return Buffer.from(fflateGzip(input));
}

export function gunzipSync(data: Uint8Array | Buffer): Buffer {
  const input = data instanceof Uint8Array ? data : new Uint8Array(data);
  return Buffer.from(fflateGunzip(input));
}
