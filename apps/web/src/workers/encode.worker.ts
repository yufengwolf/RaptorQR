/**
 * Encode worker — receives raw data, compresses, and packetizes.
 *
 * @module
 */

import { packetizeRaptorQ } from '@raptorqr/core/sender/raptorq_packetizer';
import {
  packetizeLegacyRlnc,
  scheduleLegacyRlncFrames,
} from '@raptorqr/core/sender/legacy_rlnc';
import { MAX_PAYLOAD_SIZE } from '@raptorqr/core/protocol/constants';
import {
  DEFAULT_RAPTORQ_REPAIR_PERCENT,
  normalizeFecCodec,
  normalizeRaptorQRepairPercent,
  type FecCodec,
} from '@raptorqr/core/fec/codec';
import { zipSync } from 'fflate';
import {
  BUNDLE_FILENAME_SENTINEL,
  BUNDLE_MIME,
} from '../lib/bundle';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BundleEntry {
  name: string;
  data: ArrayBuffer;
}

interface EncodeInput {
  type: 'encode';
  data?: ArrayBuffer;
  isText?: boolean;
  compress?: boolean;
  filename?: string;
  mimeType?: string;
  symbolSize?: number;
  fecCodec?: FecCodec;
  raptorqRepairPercent?: number;
  bundleEntries?: BundleEntry[];
}

interface EncodeOutput {
  type: 'encoded';
  packets: Uint8Array[];
  sourcePacketIndices?: number[];
  repairPacketIndices?: number[];
  totalGenerations: number;
  stats: {
    originalSize: number;
    preprocessedSize: number;
    frameCount: number;
  };
}

interface ErrorOutput {
  type: 'error';
  message: string;
}

// ─── Worker handler ──────────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<EncodeInput>) => {
  const msg = e.data;
  if (msg.type !== 'encode') return;

  void (async () => {
    try {
      const result = await handleEncode(msg);
      const transfer: ArrayBufferLike[] = result.packets
        .map((p) => p.buffer as ArrayBuffer)
        .filter((b): b is ArrayBuffer => b instanceof ArrayBuffer && b.byteLength <= 1024 * 1024);
      self.postMessage(result, transfer.length > 0 ? { transfer } : undefined);
    } catch (err: any) {
      self.postMessage({ type: 'error', message: err.message ?? String(err) } satisfies ErrorOutput);
    }
  })();
};

async function handleEncode(input: EncodeInput): Promise<EncodeOutput> {
  const fecCodec = normalizeFecCodec(input.fecCodec);
  const isRaptorQ = fecCodec === 'wasm-raptorq';

  let dataToPacketize: Uint8Array;
  let isText: boolean;
  let compress: boolean;
  let filename: string | undefined;
  let mimeType: string | undefined;
  let originalSize: number;

  if (input.bundleEntries && input.bundleEntries.length > 0) {
    // Pack selected files/folders into a single ZIP at max compression.
    const files: Record<string, Uint8Array> = {};
    let total = 0;
    for (const entry of input.bundleEntries) {
      const bytes = new Uint8Array(entry.data);
      files[entry.name] = bytes;
      total += bytes.length;
    }
    const zip = zipSync(files, { level: 9 });
    dataToPacketize = zip;
    isText = false;
    compress = false;
    filename = BUNDLE_FILENAME_SENTINEL;
    mimeType = BUNDLE_MIME;
    originalSize = total;
  } else {
    dataToPacketize = new Uint8Array(input.data ?? new ArrayBuffer(0));
    isText = input.isText ?? false;
    compress = input.compress ?? false;
    filename = input.filename;
    mimeType = input.mimeType;
    originalSize = dataToPacketize.length;
  }

  if (isRaptorQ) {
    const result = await packetizeRaptorQ(
      dataToPacketize,
      isText,
      compress,
      filename,
      mimeType,
      {
        maxTransportPayloadSize: input.symbolSize ?? MAX_PAYLOAD_SIZE,
        repairPercent: normalizeRaptorQRepairPercent(
          input.raptorqRepairPercent ?? DEFAULT_RAPTORQ_REPAIR_PERCENT,
        ),
      },
    );

    return {
      type: 'encoded',
      packets: result.packets,
      sourcePacketIndices: result.sourcePacketIndices,
      repairPacketIndices: result.repairPacketIndices,
      totalGenerations: result.totalGenerations,
      stats: {
        originalSize,
        preprocessedSize: result.dataLength,
        frameCount: result.packets.length,
      },
    };
  }

  // Legacy JS RLNC is explicit only; do not use it as a RaptorQ fallback.
  const result = packetizeLegacyRlnc(
    dataToPacketize,
    isText,
    compress,
    filename,
    mimeType,
    { symbolSize: input.symbolSize },
  );
  const frames = scheduleLegacyRlncFrames(result.packets, result.totalGenerations);

  return {
    type: 'encoded',
    packets: frames,
    totalGenerations: result.totalGenerations,
    stats: {
      originalSize,
      preprocessedSize: result.dataLength,
      frameCount: frames.length,
    },
  };
}
