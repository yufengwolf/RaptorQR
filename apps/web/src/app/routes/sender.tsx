/**
 * Sender page — text/file input, live QR playback, and GIF export.
 */
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';
import { t, useLang } from '@/lib/i18n';
import type { EccLevel } from '@raptorqr/core/qr/qr_encode';
import {
  DEFAULT_QR_ENCODER,
  QR_ENCODERS,
  formatQREncoder,
  normalizeQREncoder,
  type QREncoder,
} from '@raptorqr/core/qr/qr_encoder_browser';
import {
  DEFAULT_QR_ECC_LEVEL,
  DEFAULT_QR_VERSION,
  ECC_LEVEL_OPTIONS,
  QR_VERSION_OPTIONS,
  createQRTransferProfile,
  type QRTransferProfile,
  type QRVersionOption,
} from '@raptorqr/core/protocol/profiles';
import {
  stripedFrameCount,
  stripedPacketIndex,
  type ParallelQRCount,
} from '@raptorqr/core/sender/parallel_striping';
import {
  DEFAULT_FEC_CODEC,
  DEFAULT_RAPTORQ_REPAIR_PERCENT,
  FEC_CODECS,
  MAX_RAPTORQ_REPAIR_PERCENT,
  MIN_RAPTORQ_REPAIR_PERCENT,
  formatFecCodec,
  normalizeFecCodec,
  normalizeRaptorQRepairPercent,
  type FecCodec,
} from '@raptorqr/core/fec/codec';
import {
  DEFAULT_RAPTORQ_PLAYBACK_STRATEGY,
  RAPTORQ_PLAYBACK_STRATEGIES,
  createRaptorQPlaybackOrders,
  formatRaptorQPlaybackStrategy,
  getRaptorQPlaybackWindowPacketIndices,
  normalizeRaptorQPlaybackStrategy,
  type RaptorQPlaybackOrders,
  type RaptorQPlaybackPhase,
  type RaptorQPlaybackStrategy,
} from '@raptorqr/core/sender/raptorq_playback';
import { QrWorkerPool } from '@/lib/qr_worker_pool';

// ─── Types ───────────────────────────────────────────────────────────────────

type InputMode = 'text' | 'file';

interface GifResult {
  gifData: ArrayBuffer;
  width: number;
  height: number;
  frameCount: number;
  frameRateFps: number;
  frameDelayMs: number;
  parallelCount: ParallelQRCount;
}

interface LiveTransfer {
  packets: Uint8Array[];
  initialOrder: number[];
  loopOrder: number[];
  activeOrder: RaptorQPlaybackPhase;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  version: number;
  eccLevel: EccLevel;
  qrEncoder: QREncoder;
  symbolSize: number;
  scale: number;
  displayFrameCount: number;
  parallelCount: ParallelQRCount;
}

interface RenderedTile {
  source: CanvasImageSource;
  close?: () => void;
}

interface FrameCache {
  frames: Map<number, RenderedTile>;
  maxEntries: number;
}


// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_FRAME_RATE_FPS = 2;
const MAX_FRAME_RATE_FPS = 60;
const DEFAULT_FRAME_RATE_FPS = 30;
const DEFAULT_PARALLEL_QR_COUNT: ParallelQRCount = 4;
const PARALLEL_QR_COUNTS: ParallelQRCount[] = [1, 2, 4, 6, 8];
const FEC_CODEC_OPTIONS: FecCodec[] = FEC_CODECS.map((codec) => codec.id);
const LIVE_TARGET_PX = 360;
const QR_QUIET_ZONE_MODULES = 4;
const FRAME_CACHE_LIMIT = 240;
const PREFETCH_DISPLAY_FRAMES = 120;
const QR_RENDER_BATCH_LIMIT = 32;
const RENDER_CACHE_FILL_RATIO = 0.75;
const LIVE_FPS_WINDOW_MS = 2_000;
const LIVE_STATS_UPDATE_MS = 250;

export function SenderPage() {
  useLang();
  const [mode, setMode] = useState<InputMode>('file');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [encodingLive, setEncodingLive] = useState(false);
  const [preparingGif, setPreparingGif] = useState(false);
  const [status, setStatus] = useState('');
  const [qrVersion, setQrVersion] = useState<QRVersionOption>(DEFAULT_QR_VERSION);
  const [eccLevel, setEccLevel] = useState<EccLevel>(DEFAULT_QR_ECC_LEVEL);
  const [qrEncoder, setQrEncoder] = useState<QREncoder>(DEFAULT_QR_ENCODER);
  const [fecCodec, setFecCodec] = useState<FecCodec>(DEFAULT_FEC_CODEC);
  const [raptorqRepairPercent, setRaptorqRepairPercent] = useState(DEFAULT_RAPTORQ_REPAIR_PERCENT);
  const [raptorqPlaybackStrategy, setRaptorqPlaybackStrategy] = useState<RaptorQPlaybackStrategy>(
    DEFAULT_RAPTORQ_PLAYBACK_STRATEGY,
  );
  const [advancedGenerateOpen, setAdvancedGenerateOpen] = useState(false);
  const [frameRateFps, setFrameRateFps] = useState(DEFAULT_FRAME_RATE_FPS);
  const [actualLiveFps, setActualLiveFps] = useState(0);
  const [renderReadyPackets, setRenderReadyPackets] = useState(0);
  const [renderPendingPackets, setRenderPendingPackets] = useState(0);
  const [parallelQRCount, setParallelQRCount] = useState<ParallelQRCount>(DEFAULT_PARALLEL_QR_COUNT);
  const [liveTransfer, setLiveTransfer] = useState<LiveTransfer | null>(null);
  const [gifResult, setGifResult] = useState<GifResult | null>(null);
  const [stats, setStats] = useState<{
    originalSize: number;
    preprocessedSize: number;
    frameCount: number;
    totalGenerations: number;
    qrEncoder: QREncoder;
    fecCodec: FecCodec;
    raptorqRepairPercent: number;
    raptorqPlaybackStrategy: RaptorQPlaybackStrategy | null;
  } | null>(null);
  const [error, setError] = useState('');
  const [fullscreenActive, setFullscreenActive] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const qrStageRef = useRef<HTMLDivElement | null>(null);
  const liveTransferRef = useRef<LiveTransfer | null>(null);
  const encodeWorkerRef = useRef<Worker | null>(null);
  const gifWorkerRef = useRef<Worker | null>(null);
  const qrRenderPoolRef = useRef<QrWorkerPool | null>(null);
  const rafHandleRef = useRef<number | null>(null);
  const rafLastTsRef = useRef<number | null>(null);
  const rafAccRef = useRef(0);
  const liveFrameIndexRef = useRef(0);
  const frameRateFpsRef = useRef(DEFAULT_FRAME_RATE_FPS);
  const frameCacheRef = useRef<FrameCache>(createFrameCache());
  const requestedPacketImagesRef = useRef<Set<number>>(new Set());
  const playbackStartedRef = useRef(false);
  const liveDrawCountRef = useRef(0);
  const liveDrawRateSamplesRef = useRef<Array<{ time: number; count: number }>>([]);
  const runIdRef = useRef(0);
  const qrRenderRequestIdRef = useRef(0);
  const qrProfile = createQRTransferProfile(qrVersion, eccLevel, qrEncoder);
  const frameDelayMs = frameRateToDelayMs(frameRateFps);

  const clearPlaybackTimer = useCallback(() => {
    if (rafHandleRef.current !== null) {
      window.cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }

    rafLastTsRef.current = null;
    rafAccRef.current = 0;
  }, []);

  const terminateEncodeWorker = useCallback(() => {
    encodeWorkerRef.current?.terminate();
    encodeWorkerRef.current = null;
  }, []);

  const terminateGifWorker = useCallback(() => {
    gifWorkerRef.current?.terminate();
    gifWorkerRef.current = null;
  }, []);

  const terminateQRRenderPool = useCallback(() => {
    qrRenderRequestIdRef.current++;
    qrRenderPoolRef.current?.terminate();
    qrRenderPoolRef.current = null;
  }, []);

  const updateLiveStats = useCallback(() => {
    const now = performance.now();
    const samples = liveDrawRateSamplesRef.current;
    samples.push({ time: now, count: liveDrawCountRef.current });

    while (samples.length > 1 && now - samples[0]!.time > LIVE_FPS_WINDOW_MS) {
      samples.shift();
    }

    const first = samples[0];
    const elapsedSeconds = first ? (now - first.time) / 1000 : 0;
    const rawFps = first && elapsedSeconds > 0
      ? (liveDrawCountRef.current - first.count) / elapsedSeconds
      : 0;
    const fps = Math.round(rawFps * 10) / 10;
    const readyPackets = frameCacheRef.current.frames.size;
    const pendingPackets = requestedPacketImagesRef.current.size;

    setActualLiveFps((previous) => previous === fps ? previous : fps);
    setRenderReadyPackets((previous) => previous === readyPackets ? previous : readyPackets);
    setRenderPendingPackets((previous) => previous === pendingPackets ? previous : pendingPackets);
  }, []);

  const resetLiveStats = useCallback(() => {
    liveDrawCountRef.current = 0;
    liveDrawRateSamplesRef.current = [];
    setActualLiveFps(0);
    setRenderReadyPackets(0);
    setRenderPendingPackets(0);
  }, []);

  const recordLiveFrameDraw = useCallback(() => {
    liveDrawCountRef.current++;
  }, []);

  const requestRenderWindow = useCallback((
    transfer: LiveTransfer,
    startFrameIndex: number,
  ) => {
    const pool = qrRenderPoolRef.current;
    if (!pool) return;

    const renderWindowFrames = getRenderWindowDisplayFrames(transfer, frameCacheRef.current);
    const maxOutstandingPackets = getMaxOutstandingRenderPackets(transfer, frameCacheRef.current);
    const windowPacketIndexes = getPlaybackWindowPacketIndices(
      transfer,
      startFrameIndex,
      renderWindowFrames,
    );
    const windowPacketIndexSet = new Set(windowPacketIndexes);

    pruneFrameCacheForPlaybackWindow(
      frameCacheRef.current,
      windowPacketIndexSet,
    );

    pruneRequestedPacketsForPlaybackWindow(
      requestedPacketImagesRef.current,
      windowPacketIndexSet,
    );

    let availableSlots = maxOutstandingPackets
      - frameCacheRef.current.frames.size
      - requestedPacketImagesRef.current.size;

    if (availableSlots <= 0) return;

    const missingPacketIndexes: number[] = [];
    for (const packetIndex of windowPacketIndexes) {
      if (frameCacheRef.current.frames.has(packetIndex)) continue;
      if (requestedPacketImagesRef.current.has(packetIndex)) continue;

      requestedPacketImagesRef.current.add(packetIndex);
      missingPacketIndexes.push(packetIndex);
      availableSlots--;

      if (missingPacketIndexes.length >= QR_RENDER_BATCH_LIMIT || availableSlots <= 0) break;
    }

    if (missingPacketIndexes.length === 0) return;

    const requestId = qrRenderRequestIdRef.current;

    for (const packetIndex of missingPacketIndexes) {
      const packet = transfer.packets[packetIndex];

      if (!packet) {
        requestedPacketImagesRef.current.delete(packetIndex);
        continue;
      }

      pool
        .render(
          packet,
          transfer.version,
          transfer.eccLevel,
          transfer.scale,
          transfer.qrEncoder,
        )
        .then(async (imageData) => {
          requestedPacketImagesRef.current.delete(packetIndex);

          if (requestId !== qrRenderRequestIdRef.current) return;

          const activeTransfer = liveTransferRef.current;
          if (!activeTransfer) return;

          const currentFrameIndex =
            liveFrameIndexRef.current % activeTransfer.displayFrameCount;

          const activeRenderWindowFrames = getRenderWindowDisplayFrames(
            activeTransfer,
            frameCacheRef.current,
          );
          const activeWindowPackets = new Set(getPlaybackWindowPacketIndices(
            activeTransfer,
            currentFrameIndex,
            activeRenderWindowFrames,
          ));

          if (!activeWindowPackets.has(packetIndex)) {
            return;
          }

          const renderedTile = await prepareRenderedTile(imageData);

          if (requestId !== qrRenderRequestIdRef.current) {
            closeRenderedTile(renderedTile);
            return;
          }

          const latestWindowPackets = new Set(getPlaybackWindowPacketIndices(
            activeTransfer,
            liveFrameIndexRef.current % activeTransfer.displayFrameCount,
            activeRenderWindowFrames,
          ));
          if (!latestWindowPackets.has(packetIndex)) {
            closeRenderedTile(renderedTile);
            return;
          }

          cacheRenderedTile(frameCacheRef.current, packetIndex, renderedTile);
          trimFrameCache(frameCacheRef.current, activeTransfer, liveFrameIndexRef.current);
        })
        .catch((err: unknown) => {
          requestedPacketImagesRef.current.delete(packetIndex);

          if (requestId !== qrRenderRequestIdRef.current) return;

          setError(err instanceof Error ? err.message : String(err));
        });
    }
  }, []);

  const runRafLoop = useCallback((timestamp: number) => {
    const transfer = liveTransferRef.current;
    const canvas = canvasRef.current;

    if (!transfer || !canvas) {
      rafHandleRef.current = null;
      return;
    }

    const frameInterval = frameRateToDelayMs(frameRateFpsRef.current);

    if (rafLastTsRef.current === null) {
      rafLastTsRef.current = timestamp;
      rafAccRef.current = Math.max(rafAccRef.current, frameInterval);
    } else {
      rafAccRef.current += timestamp - rafLastTsRef.current;
      rafLastTsRef.current = timestamp;
    }

    let advanced = 0;

    while (rafAccRef.current >= frameInterval && advanced < 2) {
      const frameIndex = liveFrameIndexRef.current % transfer.displayFrameCount;

      requestRenderWindow(transfer, frameIndex);

      if (!isDisplayFrameReady(transfer, frameIndex, frameCacheRef.current)) {
        rafAccRef.current = Math.min(rafAccRef.current, frameInterval);
        break;
      }

      rafAccRef.current -= frameInterval;

      try {
        drawLiveFrame(canvas, transfer, frameIndex, frameCacheRef.current);
      } catch (err: unknown) {
        if (rafHandleRef.current !== null) {
          window.cancelAnimationFrame(rafHandleRef.current);
          rafHandleRef.current = null;
        }

        rafLastTsRef.current = null;
        rafAccRef.current = 0;

        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      if (!playbackStartedRef.current) {
        playbackStartedRef.current = true;
        setStatus(
          t('sender.status.running', { packets: transfer.packets.length, parallel: transfer.parallelCount }),
        );
      }

      recordLiveFrameDraw();

      liveFrameIndexRef.current = (frameIndex + 1) % transfer.displayFrameCount;

      // Balanced uses a source-first first pass for Live, then switches only
      // after the final initial display frame was actually drawn. This keeps
      // the render cache keyed by canonical packet index while the playback
      // order changes underneath it.
      if (
        transfer.activeOrder === 'initial' &&
        frameIndex === transfer.displayFrameCount - 1
      ) {
        transfer.activeOrder = 'loop';
      }

      requestRenderWindow(transfer, liveFrameIndexRef.current);
      advanced++;
    }

    rafHandleRef.current = window.requestAnimationFrame(runRafLoop);
  }, [recordLiveFrameDraw, requestRenderWindow]);

  const startLivePlayback = useCallback((resetIndex: boolean) => {
    clearPlaybackTimer();

    const transfer = liveTransferRef.current;
    const canvas = canvasRef.current;
    if (!transfer || !canvas) return;

    if (resetIndex) {
      liveFrameIndexRef.current = 0;
    }

    const frameIndex = liveFrameIndexRef.current % transfer.displayFrameCount;
    requestRenderWindow(transfer, frameIndex);

    rafAccRef.current = frameRateToDelayMs(frameRateFpsRef.current);
    rafHandleRef.current = window.requestAnimationFrame(runRafLoop);
  }, [clearPlaybackTimer, requestRenderWindow, runRafLoop]);

  useEffect(() => {
    frameRateFpsRef.current = frameRateFps;
  }, [frameRateFps]);

  useEffect(() => {
    if (!liveTransfer) return;

    updateLiveStats();
    const statsTimer = window.setInterval(updateLiveStats, LIVE_STATS_UPDATE_MS);
    return () => window.clearInterval(statsTimer);
  }, [liveTransfer, updateLiveStats]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreenActive(document.fullscreenElement === qrStageRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    liveTransferRef.current = liveTransfer;

    clearFrameCache(frameCacheRef.current);
    requestedPacketImagesRef.current.clear();
    playbackStartedRef.current = false;

    resetLiveStats();
    clearPlaybackTimer();
    terminateQRRenderPool();

    if (!liveTransfer) {
      return clearPlaybackTimer;
    }

    qrRenderRequestIdRef.current++;

    const pool = new QrWorkerPool(liveTransfer.parallelCount);
    qrRenderPoolRef.current = pool;

    setStatus(t('sender.status.renderFirst'));

    requestRenderWindow(liveTransfer, 0);
    startLivePlayback(true);

    return () => {
      qrRenderRequestIdRef.current++;
      clearPlaybackTimer();

      if (qrRenderPoolRef.current === pool) {
        qrRenderPoolRef.current = null;
      }

      pool.terminate();

      requestedPacketImagesRef.current.clear();
      playbackStartedRef.current = false;

      clearFrameCache(frameCacheRef.current);
      resetLiveStats();
    };
  }, [
    liveTransfer,
    clearPlaybackTimer,
    requestRenderWindow,
    resetLiveStats,
    startLivePlayback,
    terminateQRRenderPool,
  ]);

  /** Wipe all output state and stop any live playback loop. */
  const resetOutput = useCallback(() => {
    runIdRef.current++;
    terminateEncodeWorker();
    terminateGifWorker();
    terminateQRRenderPool();
    clearPlaybackTimer();
    liveTransferRef.current = null;
    liveFrameIndexRef.current = 0;
    clearFrameCache(frameCacheRef.current);
    requestedPacketImagesRef.current.clear();
    playbackStartedRef.current = false;
    resetLiveStats();
    setLiveTransfer(null);
    setGifResult(null);
    setStats(null);
    setEncodingLive(false);
    setPreparingGif(false);
    setError('');
    setStatus('');
  }, [clearPlaybackTimer, resetLiveStats, terminateEncodeWorker, terminateGifWorker, terminateQRRenderPool]);

  const handleStopTransfer = useCallback(() => {
    resetOutput();
    setStatus(t('sender.status.stopped'));
  }, [resetOutput]);

  const handleModeChange = useCallback((newMode: InputMode) => {
    setMode(newMode);
    resetOutput();
  }, [resetOutput]);

  const handleTextChange = useCallback((value: string) => {
    setText(value);
    if (liveTransfer || gifResult || stats || encodingLive || preparingGif) {
      resetOutput();
    }
  }, [resetOutput, liveTransfer, gifResult, stats, encodingLive, preparingGif]);

  const handleFile = useCallback((e: Event) => {
    const input = e.target as HTMLInputElement;
    const newFile = input.files?.[0] ?? null;
    setFile(newFile);
    resetOutput();
  }, [resetOutput]);

  const handleChooseFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleQRVersionChange = useCallback((value: string) => {
    setQrVersion(parseQRVersionOption(value));
    resetOutput();
  }, [resetOutput]);

  const handleEccLevelChange = useCallback((value: string) => {
    setEccLevel(normalizeEccLevel(value));
    resetOutput();
  }, [resetOutput]);

  const handleQREncoderChange = useCallback((value: string) => {
    setQrEncoder(normalizeQREncoder(value));
    resetOutput();
  }, [resetOutput]);

  const handleFecCodecChange = useCallback((value: string) => {
    setFecCodec(normalizeFecCodec(value));
    resetOutput();
  }, [resetOutput]);

  const handleRaptorQRepairPercentChange = useCallback((value: string) => {
    setRaptorqRepairPercent(normalizeRaptorQRepairPercent(value));
    resetOutput();
  }, [resetOutput]);

  const handleRaptorQPlaybackStrategyChange = useCallback((value: string) => {
    setRaptorqPlaybackStrategy(normalizeRaptorQPlaybackStrategy(value));
    resetOutput();
  }, [resetOutput]);

  const handleFrameRateChange = useCallback((value: string) => {
    const nextFrameRate = clampFrameRate(Number(value));
    frameRateFpsRef.current = nextFrameRate;
    setFrameRateFps(nextFrameRate);
    if (liveTransferRef.current) {
      startLivePlayback(false);
    }
  }, [startLivePlayback]);

  const handleParallelQRCountChange = useCallback((value: string) => {
    setParallelQRCount(normalizeParallelQRCount(Number(value)));
    resetOutput();
  }, [resetOutput]);

  const handleStartLiveTransfer = useCallback(async () => {
    resetOutput();
    const runId = runIdRef.current;

    let data: ArrayBuffer;
    let isText: boolean;

    if (mode === 'text') {
      const trimmed = text.trim();
      if (!trimmed) { setError(t('sender.err.noText')); return; }
      data = new TextEncoder().encode(trimmed).buffer as ArrayBuffer;
      isText = true;
    } else {
      if (!file) { setError(t('sender.err.noFile')); return; }
      if (file.size > 8 * 1024 * 1024) { setError(t('sender.err.fileTooLarge')); return; }
      data = await file.arrayBuffer();
      isText = false;
    }

    const compress = data.byteLength > 64;
    const selectedQRProfile = createQRTransferProfile(qrVersion, eccLevel, qrEncoder);

    setEncodingLive(true);
    setStatus(t('sender.encoding'));

    let encodeWorker: Worker | null = null;

    try {
      const worker = new Worker(
        new URL('@/workers/encode.worker.ts', import.meta.url),
        { type: 'module' },
      );
      encodeWorker = worker;
      encodeWorkerRef.current = worker;

      const encoded = await new Promise<{
        packets: Uint8Array[];
        sourcePacketIndices?: number[];
        repairPacketIndices?: number[];
        totalGenerations: number;
        stats: { originalSize: number; preprocessedSize: number; frameCount: number };
      }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Encode worker timed out')), 120_000);
        worker.onmessage = (e: MessageEvent) => {
          clearTimeout(timeout);
          if (e.data.type === 'encoded') {
            resolve(e.data);
          } else if (e.data.type === 'error') {
            reject(new Error(e.data.message));
          }
        };
        worker.onerror = (err) => { clearTimeout(timeout); reject(err); };
        worker.postMessage(
          {
            type: 'encode',
            data,
            isText,
            compress,
            symbolSize: selectedQRProfile.maxPayloadSize,
            fecCodec,
            raptorqRepairPercent,
            filename: mode === 'file' ? file?.name : undefined,
            mimeType: mode === 'file' ? file?.type : undefined,
          },
          [data],
        );
      });

      if (runId !== runIdRef.current) return;

      setStats({
        originalSize: encoded.stats.originalSize,
        preprocessedSize: encoded.stats.preprocessedSize,
        frameCount: encoded.stats.frameCount,
        totalGenerations: encoded.totalGenerations,
        qrEncoder,
        fecCodec,
        raptorqRepairPercent,
        raptorqPlaybackStrategy: fecCodec === 'wasm-raptorq'
          ? raptorqPlaybackStrategy
          : null,
      });
      const nextLiveTransfer = createLiveTransfer(
        encoded.packets,
        selectedQRProfile,
        qrEncoder,
        parallelQRCount,
        fecCodec === 'wasm-raptorq' ? raptorqPlaybackStrategy : null,
        encoded.sourcePacketIndices,
        encoded.repairPacketIndices,
      );
      setLiveTransfer(nextLiveTransfer);
      setStatus(t('sender.status.encoded', { n: encoded.stats.frameCount }));
    } catch (err: any) {
      if (runId === runIdRef.current) {
        setError(err.message ?? String(err));
      }
    } finally {
      if (encodeWorker) {
        encodeWorker.terminate();
      }
      if (encodeWorkerRef.current === encodeWorker) {
        encodeWorkerRef.current = null;
      }
      if (runId === runIdRef.current) {
        setEncodingLive(false);
      }
    }
  }, [
    mode,
    text,
    file,
    resetOutput,
    qrVersion,
    eccLevel,
    qrEncoder,
    fecCodec,
    raptorqRepairPercent,
    raptorqPlaybackStrategy,
    parallelQRCount,
  ]);

  const handlePrepareGif = useCallback(async () => {
    const transfer = liveTransferRef.current;
    if (!transfer) {
      setError(t('sender.err.gifBeforeLive'));
      return;
    }

    const runId = runIdRef.current;
    setPreparingGif(true);
    setGifResult(null);
    setError('');
    setStatus(t('sender.preparingGif'));

    let gifWorker: Worker | null = null;

    try {
      const outputFrameRateFps = frameRateFpsRef.current;
      const outputFrameDelayMs = Math.round(frameRateToDelayMs(outputFrameRateFps));
      const worker = new Worker(
        new URL('@/workers/gif.worker.ts', import.meta.url),
        { type: 'module' },
      );
      gifWorker = worker;
      gifWorkerRef.current = worker;

      const gif = await new Promise<GifResult>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('GIF worker timed out')), 120_000);
        worker.onmessage = (e: MessageEvent) => {
          clearTimeout(timeout);
          if (e.data.type === 'gifReady') {
            resolve({
              gifData: e.data.gifData,
              width: e.data.width,
              height: e.data.height,
              frameCount: e.data.frameCount,
              frameRateFps: outputFrameRateFps,
              frameDelayMs: outputFrameDelayMs,
              parallelCount: transfer.parallelCount,
            });
          } else if (e.data.type === 'error') {
            reject(new Error(e.data.message));
          }
        };
        worker.onerror = (err) => { clearTimeout(timeout); reject(err); };
        worker.postMessage(
          {
            type: 'generate',
            packets: transfer.packets,
            frameDelayMs: outputFrameDelayMs,
            qrVersion: transfer.version,
            eccLevel: transfer.eccLevel,
            qrEncoder: transfer.qrEncoder,
            parallelCount: transfer.parallelCount,
            packetOrder: transfer.loopOrder,
          },
        );
      });

      if (runId !== runIdRef.current) return;

      setGifResult(gif);
      setStatus(t('sender.status.gifReady'));
    } catch (err: any) {
      if (runId === runIdRef.current) {
        setError(err.message ?? String(err));
      }
    } finally {
      if (gifWorker) {
        gifWorker.terminate();
      }
      if (gifWorkerRef.current === gifWorker) {
        gifWorkerRef.current = null;
      }
      if (runId === runIdRef.current) {
        setPreparingGif(false);
      }
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!gifResult) return;
    const blob = new Blob([gifResult.gifData], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-transfer-${stats?.totalGenerations ?? 0}g.gif`;
    a.click();
    URL.revokeObjectURL(url);
  }, [gifResult, stats]);

  const handleFullscreenPlayback = useCallback(async () => {
    const stage = qrStageRef.current;
    if (!stage) return;

    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
        return;
      }

      if (!stage.requestFullscreen) {
        setError(t('sender.err.fullscreenUnsupported'));
        return;
      }

      await stage.requestFullscreen();
    } catch (err: any) {
      setError(t('sender.err.fullscreen', { msg: err.message ?? String(err) }));
    }
  }, []);

  return (
    <>
      {/* ── Input mode ─────────────────────────────────────────────────────── */}
      <div className="rq-card">
        <div className="rq-row">
          <span className="rq-label">{t('sender.input.mode')}</span>
          <div className="rq-toggle">
            <button
              className={mode === 'file' ? 'rq-toggle-btn active' : 'rq-toggle-btn'}
              onClick={() => handleModeChange('file')}
            >
              {t('sender.input.file')}
            </button>
            <button
              className={mode === 'text' ? 'rq-toggle-btn active' : 'rq-toggle-btn'}
              onClick={() => handleModeChange('text')}
            >
              {t('sender.input.text')}
            </button>
          </div>
        </div>
        {mode === 'text' ? (
          <textarea
            className="rq-textarea"
            style={{ marginTop: 10 }}
            placeholder={t('sender.input.placeholder')}
            value={text}
            onInput={(e) => handleTextChange((e.target as HTMLTextAreaElement).value)}
          />
        ) : (
          <div className="rq-row" style={{ marginTop: 10 }}>
            <input
              ref={fileInputRef}
              type="file"
              className="rq-hidden"
              onChange={handleFile}
            />
            <button
              type="button"
              className="rq-btn-secondary"
              disabled={encodingLive}
              onClick={handleChooseFile}
            >
              {t('sender.input.chooseFile')}
            </button>
            <span className="rq-filename" title={file?.name ?? ''}>
              {file ? `${file.name} · ${formatBytes(file.size)}` : t('sender.input.noFile')}
            </span>
          </div>
        )}
      </div>

      <div className="rq-grid">
        {/* ── LEFT: generate settings ─────────────────────────────────────── */}
        <div className="rq-col">
          <div className="rq-card">
            <div className="rq-card-title">{t('sender.generate')}</div>

            <div style={{ marginBottom: 16 }}>
              <div className="rq-row-between">
                <span className="rq-label">{t('sender.size')}</span>
                <span className="rq-info-v">{qrProfile.maxPayloadSize} B/frame</span>
              </div>
              <select
                value={qrVersion}
                className="rq-select"
                disabled={encodingLive}
                onChange={(e) => handleQRVersionChange((e.target as HTMLSelectElement).value)}
              >
                {QR_VERSION_OPTIONS.map((version) => {
                  const profile = createQRTransferProfile(version, eccLevel, qrEncoder);
                  return (
                    <option key={version} value={version}>
                      V{version} · {profile.maxPayloadSize} B/frame
                    </option>
                  );
                })}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="rq-row-between">
                <span className="rq-label">{t('sender.ecc')}</span>
                <span className="rq-info-v">{eccLevel}</span>
              </div>
              <select
                value={eccLevel}
                className="rq-select"
                disabled={encodingLive}
                onChange={(e) => handleEccLevelChange((e.target as HTMLSelectElement).value)}
              >
                {ECC_LEVEL_OPTIONS.map((level) => {
                  const profile = createQRTransferProfile(qrVersion, level, qrEncoder);
                  return (
                    <option key={level} value={level}>
                      {formatEccLevel(level)} · {profile.maxPayloadSize} B/frame
                    </option>
                  );
                })}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <button
                type="button"
                className="rq-btn-secondary"
                onClick={() => setAdvancedGenerateOpen((open) => !open)}
              >
                {advancedGenerateOpen ? t('sender.advanced.hide') : t('sender.advanced.show')}
              </button>
              {advancedGenerateOpen && (
                <div style={{ marginTop: 14, display: 'grid', gap: 16 }}>
                  <label>
                    <div className="rq-row-between">
                      <span className="rq-label">{t('sender.encoder')}</span>
                      <span className="rq-info-v">{formatQREncoder(qrEncoder)}</span>
                    </div>
                    <select
                      value={qrEncoder}
                      className="rq-select"
                      disabled={encodingLive}
                      onChange={(e) => handleQREncoderChange((e.target as HTMLSelectElement).value)}
                    >
                      {QR_ENCODERS.map((encoder) => (
                        <option key={encoder} value={encoder}>
                          {formatQREncoder(encoder)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <div className="rq-row-between">
                      <span className="rq-label">{t('sender.fec')}</span>
                      <span className="rq-info-v">{formatFecCodec(fecCodec)}</span>
                    </div>
                    <select
                      value={fecCodec}
                      className="rq-select"
                      disabled={encodingLive}
                      onChange={(e) => handleFecCodecChange((e.target as HTMLSelectElement).value)}
                    >
                      {FEC_CODEC_OPTIONS.map((codec) => (
                        <option key={codec} value={codec}>
                          {formatFecCodec(codec)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {fecCodec === 'wasm-raptorq' && (
                    <>
                      <label>
                        <div className="rq-row-between">
                          <span className="rq-label">{t('sender.raptorq.repair')}</span>
                          <span className="rq-info-v">{raptorqRepairPercent}%</span>
                        </div>
                        <input
                          type="range"
                          className="rq-range"
                          min={MIN_RAPTORQ_REPAIR_PERCENT}
                          max={MAX_RAPTORQ_REPAIR_PERCENT}
                          step={1}
                          value={raptorqRepairPercent}
                          disabled={encodingLive || liveTransfer !== null}
                          onInput={(e) => handleRaptorQRepairPercentChange((e.target as HTMLInputElement).value)}
                        />
                        <div className="rq-slider-labels">
                          <span>{t('sender.raptorq.repair.less')}</span>
                          <span>{t('sender.raptorq.repair.more')}</span>
                        </div>
                      </label>
                      <label>
                        <div className="rq-row-between">
                          <span className="rq-label">{t('sender.raptorq.playback')}</span>
                          <span className="rq-info-v">{formatRaptorQPlaybackStrategy(raptorqPlaybackStrategy)}</span>
                        </div>
                        <select
                          value={raptorqPlaybackStrategy}
                          className="rq-select"
                          disabled={encodingLive || liveTransfer !== null}
                          onChange={(e) => handleRaptorQPlaybackStrategyChange((e.target as HTMLSelectElement).value)}
                        >
                          {RAPTORQ_PLAYBACK_STRATEGIES.map((strategy) => (
                            <option key={strategy} value={strategy}>
                              {formatRaptorQPlaybackStrategy(strategy)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="rq-row-between">
                <span className="rq-label">{t('sender.speed')}</span>
                <span className="rq-info-v">{frameRateFps} fps · {formatDelayMs(frameDelayMs)} ms/frame</span>
              </div>
              <input
                type="range"
                className="rq-range"
                min={MIN_FRAME_RATE_FPS}
                max={MAX_FRAME_RATE_FPS}
                step={1}
                value={frameRateFps}
                onInput={(e) => handleFrameRateChange((e.target as HTMLInputElement).value)}
              />
              <div className="rq-slider-labels">
                <span>{t('sender.speed.stable')}</span>
                <span>{t('sender.speed.fast')}</span>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="rq-row-between">
                <span className="rq-label">{t('sender.parallel')}</span>
                <span className="rq-info-v">{parallelQRCount} per tick</span>
              </div>
              <select
                value={parallelQRCount}
                className="rq-select"
                disabled={encodingLive}
                onChange={(e) => handleParallelQRCountChange((e.target as HTMLSelectElement).value)}
              >
                {PARALLEL_QR_COUNTS.map((count) => (
                  <option key={count} value={count}>
                    {t('sender.parallel.perTick', { count })}
                  </option>
                ))}
              </select>
              {parallelQRCount > 4 && (
                <div className="rq-warn">
                  {t('sender.warn.parallel', { n: parallelQRCount })}
                </div>
              )}
            </div>

            <div className="rq-row">
              <button
                className="rq-btn"
                disabled={encodingLive}
                onClick={handleStartLiveTransfer}
              >
                {encodingLive ? (
                  <>
                    <span className="rq-spinner" />
                    {t('sender.encoding')}
                  </>
                ) : (
                  t('sender.start')
                )}
              </button>
              {(liveTransfer || preparingGif) && (
                <button className="rq-btn-secondary" onClick={handleStopTransfer}>
                  {t('sender.stop')}
                </button>
              )}
            </div>
            {status && <div className="rq-status">{status}</div>}
            {error && <div className="rq-warn">⚠ {error}</div>}
          </div>
        </div>

        {/* ── RIGHT: live preview + stats ─────────────────────────────────── */}
        <div className="rq-col">
          <div className="rq-card">
            <div className="rq-card-title">{t('sender.live.title')}</div>
            {liveTransfer ? (
              <>
                <div
                  ref={qrStageRef}
                  className={fullscreenActive ? 'rq-stage rq-stage-fullscreen' : 'rq-stage'}
                >
                  <canvas
                    className="rq-stage-canvas"
                    ref={canvasRef}
                    width={liveTransfer.width}
                    height={liveTransfer.height}
                    aria-label="Live QR transfer frames"
                  />
                </div>
                <div className="rq-row" style={{ marginTop: 8 }}>
                  <button className="rq-btn-secondary" onClick={handleFullscreenPlayback}>
                    {t('sender.fullscreen')}
                  </button>
                  <button className="rq-btn-secondary" onClick={handleStopTransfer}>
                    {t('sender.stop')}
                  </button>
                  <button
                    className="rq-btn-secondary"
                    disabled={preparingGif}
                    onClick={handlePrepareGif}
                  >
                    {preparingGif ? (
                      <>
                        <span className="rq-spinner" />
                        {t('sender.preparingGif')}
                      </>
                    ) : (
                      t('sender.prepareGif')
                    )}
                  </button>
                  {gifResult && (
                    <button className="rq-btn" onClick={handleDownload}>
                      {t('sender.downloadGif', { kb: Math.round(gifResult.gifData.byteLength / 1024) })}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="rq-stage rq-stage-empty">
                <div className="rq-stage-hint">{t('sender.live.hint')}</div>
              </div>
            )}
          </div>

          {stats && (
            <div className="rq-card">
              <div className="rq-card-title">{t('sender.info.title')}</div>
              <div className="rq-info">
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.original')}</span>
                  <span className="rq-info-v">{formatBytes(stats.originalSize)}</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.preprocessed')}</span>
                  <span className="rq-info-v">{formatBytes(stats.preprocessedSize)}</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.qrVersion')}</span>
                  <span className="rq-info-v">{liveTransfer ? `V${liveTransfer.version}-${liveTransfer.eccLevel}` : qrProfile.label}</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.encoder')}</span>
                  <span className="rq-info-v">{formatQREncoder(stats.qrEncoder)}</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.payload')}</span>
                  <span className="rq-info-v">{liveTransfer ? `${liveTransfer.symbolSize} B/frame` : `${qrProfile.maxPayloadSize} B/frame`}</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.fec')}</span>
                  <span className="rq-info-v">
                    {stats.fecCodec === 'wasm-raptorq'
                      ? `${formatFecCodec(stats.fecCodec)} · ${stats.raptorqRepairPercent}% repair`
                      : formatFecCodec(stats.fecCodec)}
                  </span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.playback')}</span>
                  <span className="rq-info-v">
                    {stats.raptorqPlaybackStrategy
                      ? formatRaptorQPlaybackStrategy(stats.raptorqPlaybackStrategy)
                      : t('sender.info.notApplicable')}
                  </span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.packets')}</span>
                  <span className="rq-info-v">{stats.frameCount}</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.parallel')}</span>
                  <span className="rq-info-v">{liveTransfer ? `${liveTransfer.parallelCount} per tick` : `${parallelQRCount} per tick`}</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.liveSpeed')}</span>
                  <span className="rq-info-v">{frameRateFps} fps ({formatDelayMs(frameDelayMs)} ms)</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.actualFps')}</span>
                  <span className="rq-info-v">
                    {liveTransfer
                      ? `${actualLiveFps.toFixed(1)} fps · ${(actualLiveFps * liveTransfer.parallelCount).toFixed(1)} QR/s`
                      : t('sender.info.notRunning')}
                  </span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.renderCache')}</span>
                  <span className="rq-info-v">
                    {liveTransfer
                      ? `${renderReadyPackets} ready · ${renderPendingPackets} pending`
                      : t('sender.info.notRunning')}
                  </span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.gifSpeed')}</span>
                  <span className="rq-info-v">{gifResult ? `${gifResult.frameRateFps} fps (${formatDelayMs(gifResult.frameDelayMs)} ms)` : preparingGif ? t('sender.info.preparing') : t('sender.info.notPrepared')}</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{stats.fecCodec === 'wasm-raptorq' ? t('sender.info.raptorqPackets') : t('sender.info.generations')}</span>
                  <span className="rq-info-v">{stats.totalGenerations}</span>
                </div>
                <div className="rq-info-cell">
                  <span className="rq-info-k">{t('sender.info.gifSize')}</span>
                  <span className="rq-info-v">{gifResult ? formatBytes(gifResult.gifData.byteLength) : preparingGif ? '…' : t('sender.info.notPrepared')}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function clampFrameRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FRAME_RATE_FPS;
  return Math.min(MAX_FRAME_RATE_FPS, Math.max(MIN_FRAME_RATE_FPS, Math.round(value)));
}

function normalizeParallelQRCount(value: number): ParallelQRCount {
  return PARALLEL_QR_COUNTS.includes(value as ParallelQRCount)
    ? value as ParallelQRCount
    : DEFAULT_PARALLEL_QR_COUNT;
}

function parseQRVersionOption(value: string): QRVersionOption {
  const parsed = Number(value);
  return QR_VERSION_OPTIONS.includes(parsed as QRVersionOption)
    ? parsed as QRVersionOption
    : DEFAULT_QR_VERSION;
}

function normalizeEccLevel(value: string): EccLevel {
  return ECC_LEVEL_OPTIONS.includes(value as EccLevel)
    ? value as EccLevel
    : DEFAULT_QR_ECC_LEVEL;
}

function formatEccLevel(level: EccLevel): string {
  switch (level) {
    case 'L':
      return 'L - low';
    case 'M':
      return 'M - medium';
    case 'Q':
      return 'Q - quartile';
    case 'H':
      return 'H - high';
  }
}

function frameRateToDelayMs(fps: number): number {
  return 1000 / clampFrameRate(fps);
}

function formatDelayMs(ms: number): string {
  return Number.isInteger(ms) ? String(ms) : ms.toFixed(1);
}

function createFrameCache(): FrameCache {
  return { frames: new Map(), maxEntries: FRAME_CACHE_LIMIT };
}

async function prepareRenderedTile(imageData: ImageData): Promise<RenderedTile> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(imageData);
    return {
      source: bitmap,
      close: () => bitmap.close(),
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable for QR tile cache.');
  }
  ctx.putImageData(imageData, 0, 0);
  return { source: canvas };
}

function cacheRenderedTile(
  cache: FrameCache,
  packetIndex: number,
  tile: RenderedTile,
): void {
  const previous = cache.frames.get(packetIndex);
  if (previous) closeRenderedTile(previous);
  cache.frames.set(packetIndex, tile);
}

function closeRenderedTile(tile: RenderedTile): void {
  tile.close?.();
}

function clearFrameCache(cache: FrameCache): void {
  for (const tile of cache.frames.values()) {
    closeRenderedTile(tile);
  }
  cache.frames.clear();
}

function createLiveTransfer(
  packets: Uint8Array[],
  profile: QRTransferProfile,
  qrEncoder: QREncoder,
  parallelCount: ParallelQRCount,
  raptorqStrategy: RaptorQPlaybackStrategy | null,
  sourcePacketIndices?: number[],
  repairPacketIndices?: number[],
): LiveTransfer {
  if (packets.length === 0) {
    throw new Error('No QR packets were generated.');
  }

  const moduleCount = profile.version * 4 + 17;
  const totalModules = moduleCount + QR_QUIET_ZONE_MODULES * 2;
  const scale = Math.max(2, Math.round(LIVE_TARGET_PX / totalModules));
  const tileSize = totalModules * scale;
  const layout = getParallelLayout(parallelCount);
  const packetIndexes = Array.from({ length: packets.length }, (_, index) => index);
  let playbackOrders: RaptorQPlaybackOrders;
  if (raptorqStrategy) {
    if (!sourcePacketIndices || !repairPacketIndices) {
      throw new Error('RaptorQ packet classification metadata is missing.');
    }
    playbackOrders = createRaptorQPlaybackOrders(
      sourcePacketIndices,
      repairPacketIndices,
      raptorqStrategy,
    );
  } else {
    playbackOrders = {
      initialOrder: packetIndexes,
      loopOrder: packetIndexes,
    };
  }

  return {
    packets,
    ...playbackOrders,
    activeOrder: 'initial',
    width: tileSize * layout.columns,
    height: tileSize * layout.rows,
    tileWidth: tileSize,
    tileHeight: tileSize,
    columns: layout.columns,
    rows: layout.rows,
    version: profile.version,
    eccLevel: profile.eccLevel,
    qrEncoder,
    symbolSize: profile.maxPayloadSize,
    scale,
    displayFrameCount: stripedFrameCount(packets.length, parallelCount),
    parallelCount,
  };
}

function drawLiveFrame(
  canvas: HTMLCanvasElement,
  transfer: LiveTransfer,
  frameIndex: number,
  cache: FrameCache,
): void {
  if (canvas.width !== transfer.width) canvas.width = transfer.width;
  if (canvas.height !== transfer.height) canvas.height = transfer.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, transfer.width, transfer.height);

  for (let tileIndex = 0; tileIndex < transfer.parallelCount; tileIndex++) {
    const packetIndex = getPacketIndexForDisplayFrame(transfer, frameIndex, tileIndex);
    if (packetIndex === null) continue;
    const image = cache.frames.get(packetIndex);
    if (!image) continue;
    const x = (tileIndex % transfer.columns) * transfer.tileWidth;
    const y = Math.floor(tileIndex / transfer.columns) * transfer.tileHeight;
    ctx.drawImage(image.source, x, y, transfer.tileWidth, transfer.tileHeight);
  }
}

function isDisplayFrameReady(
  transfer: LiveTransfer,
  frameIndex: number,
  cache: FrameCache,
): boolean {
  for (let tileIndex = 0; tileIndex < transfer.parallelCount; tileIndex++) {
    const packetIndex = getPacketIndexForDisplayFrame(transfer, frameIndex, tileIndex);
    if (packetIndex !== null && !cache.frames.has(packetIndex)) {
      return false;
    }
  }
  return true;
}

function trimFrameCache(
  cache: FrameCache,
  transfer?: LiveTransfer,
  startFrameIndex = 0,
): void {
  if (transfer) {
    const renderWindowFrames = getRenderWindowDisplayFrames(transfer, cache);
    const windowPacketIndexes = new Set(getPlaybackWindowPacketIndices(
      transfer,
      startFrameIndex,
      renderWindowFrames,
    ));
    pruneFrameCacheForPlaybackWindow(cache, windowPacketIndexes);
  }

  while (cache.frames.size > cache.maxEntries) {
    const oldestKey = cache.frames.keys().next().value;
    if (oldestKey === undefined) return;
    const oldestTile = cache.frames.get(oldestKey);
    if (oldestTile) closeRenderedTile(oldestTile);
    cache.frames.delete(oldestKey);
  }
}

function getRenderWindowDisplayFrames(transfer: LiveTransfer, cache: FrameCache): number {
  const maxCachedFrames = Math.max(1, Math.floor(cache.maxEntries / transfer.parallelCount));
  const targetFrames = Math.max(1, Math.floor(maxCachedFrames * RENDER_CACHE_FILL_RATIO));
  return Math.min(PREFETCH_DISPLAY_FRAMES, targetFrames, transfer.displayFrameCount);
}

function getMaxOutstandingRenderPackets(transfer: LiveTransfer, cache: FrameCache): number {
  return Math.max(
    transfer.parallelCount,
    getRenderWindowDisplayFrames(transfer, cache) * transfer.parallelCount,
  );
}

function pruneFrameCacheForPlaybackWindow(
  cache: FrameCache,
  windowPacketIndexes: ReadonlySet<number>,
): void {
  for (const [packetIndex, tile] of cache.frames) {
    if (windowPacketIndexes.has(packetIndex)) continue;
    closeRenderedTile(tile);
    cache.frames.delete(packetIndex);
  }
}

function pruneRequestedPacketsForPlaybackWindow(
  requestedPackets: Set<number>,
  windowPacketIndexes: ReadonlySet<number>,
): void {
  for (const packetIndex of requestedPackets) {
    if (windowPacketIndexes.has(packetIndex)) continue;
    requestedPackets.delete(packetIndex);
  }
}

function getPlaybackWindowPacketIndices(
  transfer: LiveTransfer,
  startFrameIndex: number,
  renderWindowFrames: number,
): number[] {
  return getRaptorQPlaybackWindowPacketIndices(
    transfer,
    transfer.activeOrder,
    transfer.parallelCount,
    startFrameIndex,
    Math.min(renderWindowFrames, transfer.displayFrameCount),
  );
}

function getParallelLayout(parallelCount: ParallelQRCount): { columns: number; rows: number } {
  if (parallelCount === 1) return { columns: 1, rows: 1 };
  if (parallelCount === 2) return { columns: 2, rows: 1 };
  if (parallelCount === 4) return { columns: 2, rows: 2 };
  if (parallelCount === 6) return { columns: 3, rows: 2 };
  return { columns: 4, rows: 2 };
}

function getPacketIndexForDisplayFrame(
  transfer: LiveTransfer,
  frameIndex: number,
  tileIndex: number,
): number | null {
  const orderedPosition = stripedPacketIndex(
    transfer.initialOrder.length,
    transfer.parallelCount,
    frameIndex,
    tileIndex,
  );
  if (orderedPosition === null) return null;

  const order = transfer.activeOrder === 'initial'
    ? transfer.initialOrder
    : transfer.loopOrder;
  return order[orderedPosition] ?? null;
}
