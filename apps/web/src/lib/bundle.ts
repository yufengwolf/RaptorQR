/**
 * Bundle (multi-file / folder) transfer helpers shared by the sender, the
 * encode worker, and the decode worker.
 *
 * A "bundle" is a ZIP archive of one or more files/folders. It is sent as the
 * payload of a normal file transfer, but tagged with a sentinel filename so the
 * receiver can detect it and unpack it into multiple files. No transport-layer
 * (packet header) changes are needed.
 *
 * @module
 */

/** Sentinel filename carried in the payload metadata to flag a bundle. */
export const BUNDLE_FILENAME_SENTINEL = '__RAPTORQR_BUNDLE__';

/** Sentinel MIME type carried alongside the bundle sentinel filename. */
export const BUNDLE_MIME = 'application/x-raptorqr-bundle';

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain',
  text: 'text/plain',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Best-effort MIME guess from a file name's extension. */
export function guessMime(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot >= 0) {
    const ext = name.slice(dot + 1).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (mime) return mime;
  }
  return 'application/octet-stream';
}

/** Whether a (filename, mime) pair identifies a RaptorQR bundle. */
export function isBundlePayload(filename: string, mime: string): boolean {
  return filename === BUNDLE_FILENAME_SENTINEL || mime === BUNDLE_MIME;
}
