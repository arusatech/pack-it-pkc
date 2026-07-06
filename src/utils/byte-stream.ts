/** Seekable binary stream backed by a Uint8Array (Node Buffer compatible). */
export class ByteStream {
  private pos = 0;

  constructor(private readonly data: Uint8Array) {}

  static fromBuffer(buf: ArrayBuffer | Uint8Array | Buffer): ByteStream {
    const bytes =
      buf instanceof Uint8Array ? buf : new Uint8Array(buf instanceof ArrayBuffer ? buf : (buf as Buffer).buffer);
    return new ByteStream(bytes);
  }

  tell(): number {
    return this.pos;
  }

  seek(position: number): void {
    this.pos = Math.max(0, Math.min(position, this.data.length));
  }

  read(length?: number): Uint8Array {
    const end =
      length === undefined ? this.data.length : Math.min(this.pos + length, this.data.length);
    const chunk = this.data.subarray(this.pos, end);
    this.pos = end;
    return chunk;
  }

  remaining(): Uint8Array {
    return this.data.subarray(this.pos);
  }

  toUint8Array(): Uint8Array {
    return this.data;
  }

  get length(): number {
    return this.data.length;
  }
}
