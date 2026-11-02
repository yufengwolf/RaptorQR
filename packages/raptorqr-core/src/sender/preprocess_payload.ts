import { deflateSync } from 'fflate';

export interface PreprocessResult {
  data: Uint8Array;
  dataLength: number;
  isCompressed: boolean;
}

export function preprocessPayload(
  data: Uint8Array,
  isText: boolean,
  compress: boolean,
  filename?: string,
  mimeType?: string,
): PreprocessResult {
  let wrapped: Uint8Array;
  if (!isText && filename) {
    const nameBytes = new TextEncoder().encode(filename);
    const mimeBytes = new TextEncoder().encode(mimeType || 'application/octet-stream');
    const nameLen = Math.min(nameBytes.length, 255);
    const mimeLen = Math.min(mimeBytes.length, 255);
    wrapped = new Uint8Array(2 + nameLen + mimeLen + data.length);
    let off = 0;
    wrapped[off++] = nameLen;
    wrapped.set(nameBytes.slice(0, nameLen), off);
    off += nameLen;
    wrapped[off++] = mimeLen;
    wrapped.set(mimeBytes.slice(0, mimeLen), off);
    off += mimeLen;
    wrapped.set(data, off);
  } else {
    wrapped = new Uint8Array(data);
  }

  if (compress && wrapped.length > 64) {
    const compressed = deflateSync(wrapped, { level: 9 });
    if (compressed.length < wrapped.length) {
      return {
        data: compressed,
        dataLength: compressed.length,
        isCompressed: true,
      };
    }
  }

  return {
    data: new Uint8Array(wrapped),
    dataLength: wrapped.length,
    isCompressed: false,
  };
}
