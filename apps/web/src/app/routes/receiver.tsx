/**
 * Receiver page — camera preview, QR decode, GIF file upload mode,
 * file download, and text display.
 */
import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { t, useLang } from '@/lib/i18n';
import { parseGif, renderGifFrame } from '@raptorqr/core/gif/gif_parser';
import {
  BINARIZER_OPTIONS,
  DECODE_PRESETS,
  DEFAULT_DECODE_PRESET,
  DEFAULT_DECODE_SETTINGS,
  DOWNSCALE_FACTOR_OPTIONS,
  MAX_SYMBOL_OPTIONS,
  type DecodePresetId,
  type DownscaleFactor,
  type MaxSymbolsMode,
  type QrBinarizer,
  type QrDecodeSettings,
} from '@raptorqr/core/qr/decode_settings';
import {
  DEFAULT_RECEIVER_FEC_CODEC,
  FEC_CODECS,
  formatFecCodec,
  normalizeReceiverFecCodec,
  type ReceiverFecCodec,
} from '@raptorqr/core/fec/codec';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReceivedFile {
  data: ArrayBuffer;
  filename: string;
  mime: string;
}

type InputMode = 'camera' | 'gif-file';

type DecodeRateSample = { time: number; count: number };

const MIN_SCAN_RATE_FPS = 2;
const MAX_SCAN_RATE_FPS = 60;
const DEFAULT_SCAN_RATE_FPS = 60;
const DECODE_RATE_WINDOW_MS = 1000;
const DECODE_PRESET_OPTIONS: DecodePresetId[] = ['fast', 'balance', 'robust', 'custom'];
const RECEIVER_FEC_CODEC_OPTIONS: ReceiverFecCodec[] = [
  'auto',
  ...FEC_CODECS.map((codec) => codec.id),
];

export function ReceiverPage() {
  useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const textResultRef = useRef<HTMLDivElement>(null);
  const fileResultRef = useRef<HTMLDivElement>(null);
  const gifFileInputRef = useRef<HTMLInputElement>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);
  const scanningRef = useRef(false);
  const captureSizeRef = useRef({ width: 0, height: 0 });

  const [inputMode, setInputMode] = useState<InputMode>('camera');
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('');
  const [totalFrames, setTotalFrames] = useState(0);
  const [framesWithQR, setFramesWithQR] = useState(0);
  const [uniquePackets, setUniquePackets] = useState(0);
  const [duplicatePackets, setDuplicatePackets] = useState(0);
  const [acceptedPackets, setAcceptedPackets] = useState(0);
  const [neededPackets, setNeededPackets] = useState(0);
  const [receivedFile, setReceivedFile] = useState<ReceivedFile | null>(null);
  const [receivedText, setReceivedText] = useState('');
  const [textCopied, setTextCopied] = useState(false);
  const [gifFileName, setGifFileName] = useState('');
  const [error, setError] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hasZoomSupport, setHasZoomSupport] = useState(false);
  const [scanRateFps, setScanRateFps] = useState(DEFAULT_SCAN_RATE_FPS);
  const [fecCodec, setFecCodec] = useState<ReceiverFecCodec>(DEFAULT_RECEIVER_FEC_CODEC);
  const [decodePreset, setDecodePreset] = useState<DecodePresetId>(DEFAULT_DECODE_PRESET);
  const [decodeSettings, setDecodeSettings] = useState<QrDecodeSettings>(DEFAULT_DECODE_SETTINGS);
  const [advancedDecodeOpen, setAdvancedDecodeOpen] = useState(false);
  const [decodedQrPerSecond, setDecodedQrPerSecond] = useState(0);
  const [detectedFecCodec, setDetectedFecCodec] = useState('');
  const [detectedQrVersion, setDetectedQrVersion] = useState(0);
  const [detectedSymbolSize, setDetectedSymbolSize] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [throughputKbps, setThroughputKbps] = useState(0);
  const [solvedGens, setSolvedGens] = useState(0);
  const [sourceGens, setSourceGens] = useState(0);
  const scanStartRef = useRef<number>(0);
  const dataLengthRef = useRef<number>(0);
  const decodedQrCountRef = useRef(0);
  const decodedQrRateSamplesRef = useRef<DecodeRateSample[]>([]);
  const decodeSettingsRef = useRef<QrDecodeSettings>(DEFAULT_DECODE_SETTINGS);
  const fecCodecRef = useRef<ReceiverFecCodec>(DEFAULT_RECEIVER_FEC_CODEC);
  const scanIntervalMs = scanRateToIntervalMs(scanRateFps);
  const scanIntervalMsRef = useRef(scanIntervalMs);

  useEffect(() => {
    scanIntervalMsRef.current = scanIntervalMs;
  }, [scanIntervalMs]);

  useEffect(() => {
    decodeSettingsRef.current = decodeSettings;
    fecCodecRef.current = fecCodec;
    workerRef.current?.postMessage({ type: 'settings', settings: decodeSettings, fecCodec });
  }, [decodeSettings, fecCodec]);

  const updateDecodedQrRate = useCallback((decodedCount: number) => {
    const now = Date.now();
    decodedQrCountRef.current = decodedCount;
    const samples = decodedQrRateSamplesRef.current;
    samples.push({ time: now, count: decodedCount });

    while (samples.length > 1 && now - samples[0]!.time > DECODE_RATE_WINDOW_MS) {
      samples.shift();
    }

    const first = samples[0];
    if (!first) {
      setDecodedQrPerSecond(0);
      return;
    }

    const elapsedSeconds = (now - first.time) / 1000;
    if (elapsedSeconds <= 0) {
      setDecodedQrPerSecond(0);
      return;
    }

    setDecodedQrPerSecond((decodedCount - first.count) / elapsedSeconds);
  }, []);

  useEffect(() => {
    if (!scanning) return;
    const id = window.setInterval(() => {
      updateDecodedQrRate(decodedQrCountRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [scanning, updateDecodedQrRate]);

  // ── Create decode worker ───────────────────────────────────────────────
  function createWorker(): Worker {
    const w = new Worker(
      new URL('@/workers/decode.worker.ts', import.meta.url),
      { type: 'module' },
    );

    w.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case 'progress': {
          setTotalFrames(msg.totalFrames ?? 0);
          const decodedQrCount = msg.framesWithQR ?? 0;
          setFramesWithQR(decodedQrCount);
          setUniquePackets(msg.uniquePackets ?? 0);
          setDuplicatePackets(msg.duplicatePackets ?? 0);
          updateDecodedQrRate(decodedQrCount);
          setAcceptedPackets(msg.acceptedPackets ?? 0);
          setNeededPackets(msg.neededPackets ?? 0);
          setSolvedGens(msg.solvedGenerations ?? 0);
          setSourceGens(msg.sourceGenerations ?? 0);
          setDetectedQrVersion(msg.qrVersion ?? 0);
          setDetectedSymbolSize(msg.symbolSize ?? 0);
          setDetectedFecCodec(msg.fecCodec ?? '');
          if (msg.dataLength) {
            dataLengthRef.current = msg.dataLength;
          }
          // Start timer on first detected frame
          if (scanStartRef.current === 0 && ((msg.totalFrames ?? 0) > 0 || (msg.framesWithQR ?? 0) > 0)) {
            scanStartRef.current = Date.now();
          }
          if (scanStartRef.current > 0) {
            const elapsed = Date.now() - scanStartRef.current;
            setElapsedMs(elapsed);
            const bytes = dataLengthRef.current;
            if (bytes > 0 && elapsed > 0) {
              setThroughputKbps((bytes / 1024) / (elapsed / 1000));
            }
          }
          setStatus(msg.status);
          break;
        }
        case 'complete': {
          if (msg.isText) {
            setReceivedText(msg.text);
            setTextCopied(false);
            setReceivedFile(null);
          } else {
            setReceivedFile({
              data: msg.data as ArrayBuffer,
              filename: msg.filename ?? 'recovered',
              mime: msg.mime ?? 'application/octet-stream',
            });
            setReceivedText('');
            setTextCopied(false);
          }
          const elapsed = scanStartRef.current > 0 ? Date.now() - scanStartRef.current : 0;
          setElapsedMs(elapsed);
          const bytes = dataLengthRef.current || (msg.data?.byteLength ?? msg.text?.length ?? 0);
          if (bytes > 0 && elapsed > 0) {
            setThroughputKbps((bytes / 1024) / (elapsed / 1000));
          }
          setStatus(t('receiver.complete'));

          // Auto-stop scanning if requested by worker
          if (msg.autoStop) {
            stopScanning();
          }

          // Auto-scroll to result
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (msg.isText && textResultRef.current) {
                textResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else if (!msg.isText && fileResultRef.current) {
                fileResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 100);
          });
          break;
        }
        case 'error': {
          setError(msg.message);
          break;
        }
      }
    };

    w.onerror = (err) => {
      setError(t('receiver.err.worker', { msg: err.message }));
    };

    return w;
  }

  // ── Try to set camera zoom via getUserMedia constraints ─────────────
  const applyCameraZoom = useCallback(async (level: number) => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const capabilities = track.getCapabilities() as any;
    if (capabilities?.zoom) {
      try {
        await track.applyConstraints({
          advanced: [{ zoom: level }],
        } as any);
        setZoomLevel(level);
        setHasZoomSupport(true);
      } catch (e: any) {
        console.warn('Camera zoom failed:', e.message);
      }
    }
  }, []);

  const handleScanRateChange = useCallback((value: string) => {
    setScanRateFps(clampScanRate(Number(value)));
  }, []);

  const handleFecCodecChange = useCallback((value: string) => {
    setFecCodec(normalizeReceiverFecCodec(value));
  }, []);

  const handleDecodePresetChange = useCallback((value: string) => {
    const preset = normalizeDecodePreset(value);
    setDecodePreset(preset);
    if (preset === 'custom') return;

    setDecodeSettings((current) => ({
      ...current,
      ...DECODE_PRESETS[preset],
    }));
  }, []);

  const updateDecodePresetField = useCallback((
    key: 'binarizer' | 'tryHarder' | 'tryRotate' | 'tryInvert',
    value: QrBinarizer | boolean,
  ) => {
    setDecodePreset('custom');
    setDecodeSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const updateDecodeAdvancedField = useCallback((
    key: 'maxSymbols' | 'tryDownscale' | 'downscaleFactor',
    value: MaxSymbolsMode | boolean | DownscaleFactor,
  ) => {
    setDecodeSettings((current) => ({ ...current, [key]: value }));
  }, []);

  // ── Start camera scanning ───────────────────────────────────────────────
  const startCameraScanning = useCallback(async () => {
    setError('');
    setReceivedFile(null);
    setReceivedText('');
    setTextCopied(false);
    setTotalFrames(0);
    setFramesWithQR(0);
    setUniquePackets(0);
    setDuplicatePackets(0);
    setAcceptedPackets(0);
    setNeededPackets(0);
    setDetectedQrVersion(0);
    setDetectedSymbolSize(0);
    setDetectedFecCodec('');
    setDecodedQrPerSecond(0);
    setElapsedMs(0);
    setThroughputKbps(0);
    setSolvedGens(0);
    setSourceGens(0);
    scanStartRef.current = 0;
    dataLengthRef.current = 0;
    decodedQrCountRef.current = 0;
    decodedQrRateSamplesRef.current = [];

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(getCameraUnavailableMessage());
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;

      // Check zoom capabilities
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = track.getCapabilities() as any;
        if (capabilities?.zoom) {
          setHasZoomSupport(true);
          setZoomLevel(1);
        } else {
          setHasZoomSupport(false);
          setZoomLevel(1);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const worker = createWorker();
      worker.postMessage({
        type: 'settings',
        settings: decodeSettingsRef.current,
        fecCodec: fecCodecRef.current,
      });
      workerRef.current = worker;

      setScanning(true);
      scanningRef.current = true;
      setStatus(t('receiver.scanning'));

      let lastCapture = 0;
      const loop = (time: number) => {
        if (!scanningRef.current) return;
        if (time - lastCapture >= scanIntervalMsRef.current) {
          captureFrame();
          lastCapture = time;
        }
        animRef.current = requestAnimationFrame(loop);
      };
      animRef.current = requestAnimationFrame(loop);
    } catch (err: any) {
      setError(t('receiver.err.camera', { msg: err.message ?? String(err) }));
    }
  }, []);

  function captureFrame(): void {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!video || !canvas || !worker || video.readyState < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 640;

    // Output canvas size: cap at 640 for performance, but preserve aspect ratio
    const maxCanvas = 640;
    const aspect = vw / vh;
    let cw: number, ch: number;
    if (aspect >= 1) {
      cw = Math.min(vw, maxCanvas);
      ch = Math.round(cw / aspect);
    } else {
      ch = Math.min(vh, maxCanvas);
      cw = Math.round(ch * aspect);
    }
    if (captureSizeRef.current.width !== cw || captureSizeRef.current.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      captureSizeRef.current = { width: cw, height: ch };
    }

    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, cw, ch);
    const imageData = ctx.getImageData(0, 0, cw, ch);
    const pixels = imageData.data.buffer as ArrayBuffer;

    worker.postMessage(
      { type: 'frame', pixels, width: cw, height: ch, realtime: true },
      [pixels],
    );
  }

  // ── Process GIF file ───────────────────────────────────────────────────
  const handleGifFile = useCallback(async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setGifFileName(`${file.name} · ${formatBytes(file.size)}`);
    setError('');
    setReceivedFile(null);
    setReceivedText('');
    setTextCopied(false);
    setTotalFrames(0);
    setFramesWithQR(0);
    setUniquePackets(0);
    setDuplicatePackets(0);
    setAcceptedPackets(0);
    setNeededPackets(0);
    setDetectedQrVersion(0);
    setDetectedSymbolSize(0);
    setDetectedFecCodec('');
    setDecodedQrPerSecond(0);
    setElapsedMs(0);
    setThroughputKbps(0);
    setSolvedGens(0);
    setSourceGens(0);
    scanStartRef.current = 0;
    dataLengthRef.current = 0;
    decodedQrCountRef.current = 0;
    decodedQrRateSamplesRef.current = [];

    const worker = createWorker();
    worker.postMessage({
      type: 'settings',
      settings: decodeSettingsRef.current,
      fecCodec: fecCodecRef.current,
    });
    workerRef.current = worker;

    setScanning(true);
    scanningRef.current = true;
    setStatus(t('receiver.parsingGif'));

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const gifData = parseGif(bytes);

      if (gifData.frames.length === 0) {
        setError(t('receiver.err.noFrames'));
        return;
      }

      setStatus(t('receiver.processingFrames', { n: gifData.frames.length }));

      for (let i = 0; i < gifData.frames.length; i++) {
        if (!scanningRef.current) break;
        const rgba = renderGifFrame(gifData, i);
        const pixelBuf = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
        worker.postMessage(
          { type: 'frame', pixels: pixelBuf, width: gifData.width, height: gifData.height },
          [pixelBuf],
        );
      }

      setStatus(t('receiver.gifProcessed'));
    } catch (err: any) {
      setError(t('receiver.err.gif', { msg: err.message ?? String(err) }));
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  // ── Stop scanning ──────────────────────────────────────────────────────────
  const stopScanning = useCallback(() => {
    setScanning(false);
    scanningRef.current = false;
    cancelAnimationFrame(animRef.current);

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setStatus(t('receiver.stopped'));
    setHasZoomSupport(false);
    setZoomLevel(1);
  }, []);

  // ── Download recovered file ──────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!receivedFile) return;
    const blob = new Blob([receivedFile.data], { type: receivedFile.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receivedFile.filename || 'recovered-file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [receivedFile]);

  const handleChooseGifFile = useCallback(() => {
    gifFileInputRef.current?.click();
  }, []);

  const handleCopyRecoveredText = useCallback(async () => {
    if (!receivedText) return;

    try {
      await copyTextToClipboard(receivedText);
      setTextCopied(true);

      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }

      copyResetTimerRef.current = window.setTimeout(() => {
        setTextCopied(false);
        copyResetTimerRef.current = null;
      }, 1500);
    } catch (err: any) {
      setError(t('receiver.err.copyFailed', { msg: err.message ?? String(err) }));
    }
  }, [receivedText]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Input mode ─────────────────────────────────────────────────────── */}
      <div className="rq-card">
        <div className="rq-row">
          <span className="rq-label">{t('receiver.input.mode')}</span>
          <div className="rq-toggle">
            <button
              className={inputMode === 'camera' ? 'rq-toggle-btn active' : 'rq-toggle-btn'}
              onClick={() => { stopScanning(); setInputMode('camera'); }}
            >
              📷 {t('receiver.input.camera')}
            </button>
            <button
              className={inputMode === 'gif-file' ? 'rq-toggle-btn active' : 'rq-toggle-btn'}
              onClick={() => { stopScanning(); setInputMode('gif-file'); }}
            >
              🎞️ {t('receiver.input.gif')}
            </button>
          </div>
        </div>
      </div>

      <div className="rq-grid">
        {/* ── LEFT: preview ─────────────────────────────────────────────── */}
        <div className="rq-col">
          {inputMode === 'camera' ? (
            <div className="rq-card">
              <div className="rq-card-title">{t('receiver.camera')}</div>
              <div className="rq-row-between" style={{ marginBottom: 14 }}>
                <span className="rq-label">{t('receiver.scanRate')}</span>
                <span className="rq-stat-v">{scanRateFps} fps · {formatDelayMs(scanIntervalMs)} ms/sample</span>
              </div>
              <input
                type="range"
                className="rq-range"
                min={MIN_SCAN_RATE_FPS}
                max={MAX_SCAN_RATE_FPS}
                step={1}
                value={scanRateFps}
                onInput={(e) => handleScanRateChange((e.target as HTMLInputElement).value)}
              />
              <div className="rq-slider-labels">
                <span>{t('receiver.scanRate.stable')}</span>
                <span>{t('receiver.scanRate.fast')}</span>
              </div>
              <div
                ref={videoContainerRef}
                style={{ position: 'relative', display: 'inline-block', maxWidth: 560, width: '100%', marginTop: 14 }}
              >
                <video ref={videoRef} className="rq-video" playsInline muted />
                {/* Scan-region overlay */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    border: '2px dashed rgba(109,139,255,.7)',
                    borderRadius: 10,
                    pointerEvents: 'none',
                  }}
                />
                {/* Corner markers */}
                <div style={{ position: 'absolute', top: 0, left: 0, width: 18, height: 18, borderTop: '3px solid #6d8bff', borderLeft: '3px solid #6d8bff', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: 0, right: 0, width: 18, height: 18, borderTop: '3px solid #6d8bff', borderRight: '3px solid #6d8bff', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, width: 18, height: 18, borderBottom: '3px solid #6d8bff', borderLeft: '3px solid #6d8bff', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, borderBottom: '3px solid #6d8bff', borderRight: '3px solid #6d8bff', pointerEvents: 'none' }} />
              </div>
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {scanning && (
                <div className="rq-stats">
                  <span>{t('receiver.stat.decoded')} <span className="rq-stat-v">{framesWithQR}</span></span>
                  <span>{t('receiver.stat.unique')} <span className="rq-stat-v">{uniquePackets}</span></span>
                  <span>{t('receiver.stat.useful')} <span className="rq-stat-v">{acceptedPackets}/{neededPackets || '?'}</span></span>
                  {duplicatePackets > 0 && (<span>{t('receiver.stat.dupes')} <span className="rq-stat-v">{duplicatePackets}</span></span>)}
                  <span>{t('receiver.stat.gens')} <span className="rq-stat-v">{solvedGens}/{sourceGens}</span></span>
                  <span>{t('receiver.stat.qr')} <span className="rq-stat-v">{formatDetectedQR(detectedQrVersion, detectedSymbolSize)}</span></span>
                  {detectedFecCodec && (<span>{t('receiver.stat.fec')} <span className="rq-stat-v">{formatDetectedFecCodec(detectedFecCodec)}</span></span>)}
                  <span>{t('receiver.stat.decode')} <span className="rq-stat-v">{decodedQrPerSecond.toFixed(1)} QR/s</span></span>
                  <span>{t('receiver.stat.time')} <span className="rq-stat-v">{formatDuration(elapsedMs)}</span></span>
                  {throughputKbps > 0 && (<span>{t('receiver.stat.speed')} <span className="rq-stat-v">{throughputKbps.toFixed(1)} KB/s</span></span>)}
                  <span>·</span>
                  <span>{status || t('receiver.stat.working')}</span>
                </div>
              )}

              <div className="rq-row" style={{ marginTop: 12 }}>
                {!scanning ? (
                  <button className="rq-btn" onClick={startCameraScanning}>
                    ▶ {t('receiver.startScan')}
                  </button>
                ) : (
                  <button className="rq-btn-stop" onClick={stopScanning}>
                    ■ {t('receiver.stopScan')}
                  </button>
                )}
                {hasZoomSupport && scanning && (
                  <div className="rq-row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('receiver.zoom')}</span>
                    <input
                      type="range"
                      className="rq-range"
                      min={1}
                      max={3}
                      step={0.5}
                      value={zoomLevel}
                      onChange={(e) => applyCameraZoom(Number((e.target as HTMLInputElement).value))}
                      style={{ width: 120 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text)', minWidth: 30 }}>{zoomLevel}×</span>
                  </div>
                )}
              </div>
              <p className="rq-hint">
                {hasZoomSupport ? t('receiver.hint.zoom') : t('receiver.hint.noZoom')}
              </p>
              <p className="rq-hint">{t('receiver.preview.cameraHint')}</p>
              {error && <div className="rq-warn">⚠ {error}</div>}
            </div>
          ) : (
            <div className="rq-card">
              <div className="rq-card-title">{t('receiver.uploadGif')}</div>
              <p className="rq-hint" style={{ marginBottom: 10 }}>{t('receiver.uploadGif.desc')}</p>
              <div className="rq-row">
                <input
                  ref={gifFileInputRef}
                  type="file"
                  accept=".gif,image/gif"
                  className="rq-hidden"
                  onChange={handleGifFile}
                />
                <button
                  type="button"
                  className="rq-btn-secondary"
                  disabled={scanning}
                  onClick={handleChooseGifFile}
                >
                  {t('receiver.chooseGif')}
                </button>
                <span className="rq-filename" title={gifFileName}>
                  {scanning ? t('receiver.processingGif') : gifFileName || t('receiver.noGif')}
                </span>
              </div>
              {scanning && (
                <div className="rq-stats">
                  <span>{t('receiver.stat.decoded')} <span className="rq-stat-v">{framesWithQR}</span></span>
                  <span>{t('receiver.stat.unique')} <span className="rq-stat-v">{uniquePackets}</span></span>
                  <span>{t('receiver.stat.useful')} <span className="rq-stat-v">{acceptedPackets}/{neededPackets || '?'}</span></span>
                  {duplicatePackets > 0 && (<span>{t('receiver.stat.dupes')} <span className="rq-stat-v">{duplicatePackets}</span></span>)}
                  <span>{t('receiver.stat.gens')} <span className="rq-stat-v">{solvedGens}/{sourceGens}</span></span>
                  <span>{t('receiver.stat.qr')} <span className="rq-stat-v">{formatDetectedQR(detectedQrVersion, detectedSymbolSize)}</span></span>
                  {detectedFecCodec && (<span>{t('receiver.stat.fec')} <span className="rq-stat-v">{formatDetectedFecCodec(detectedFecCodec)}</span></span>)}
                  <span>{t('receiver.stat.decode')} <span className="rq-stat-v">{decodedQrPerSecond.toFixed(1)} QR/s</span></span>
                  <span>{t('receiver.stat.time')} <span className="rq-stat-v">{formatDuration(elapsedMs)}</span></span>
                  {throughputKbps > 0 && (<span>{t('receiver.stat.speed')} <span className="rq-stat-v">{throughputKbps.toFixed(1)} KB/s</span></span>)}
                  <span>·</span>
                  <span>{status || t('receiver.stat.working')}</span>
                </div>
              )}
              <p className="rq-hint" style={{ marginTop: 10 }}>{t('receiver.preview.gifHint')}</p>
              {error && <div className="rq-warn" style={{ marginTop: 8 }}>⚠ {error}</div>}
            </div>
          )}
        </div>

        {/* ── RIGHT: settings + results ─────────────────────────────────── */}
        <div className="rq-col">
          <div className="rq-card">
            <div className="rq-card-title">{t('receiver.settings')}</div>
            <div style={{ marginBottom: 12 }}>
              <div className="rq-row-between">
                <span className="rq-label">{t('receiver.fec')}</span>
                <span className="rq-stat-v">{formatFecCodec(fecCodec)}</span>
              </div>
              <select
                value={fecCodec}
                className="rq-select"
                onChange={(e) => handleFecCodecChange((e.target as HTMLSelectElement).value)}
              >
                {RECEIVER_FEC_CODEC_OPTIONS.map((codec) => (
                  <option key={codec} value={codec}>
                    {formatFecCodec(codec)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div className="rq-row-between">
                <span className="rq-label">{t('receiver.decodePreset')}</span>
                <span className="rq-stat-v">{formatDecodePreset(decodePreset)}</span>
              </div>
              <select
                value={decodePreset}
                className="rq-select"
                onChange={(e) => handleDecodePresetChange((e.target as HTMLSelectElement).value)}
              >
                {DECODE_PRESET_OPTIONS.map((preset) => (
                  <option key={preset} value={preset}>
                    {formatDecodePreset(preset)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="rq-btn-secondary"
              onClick={() => setAdvancedDecodeOpen((open) => !open)}
            >
              {advancedDecodeOpen ? t('receiver.advanced.hide') : t('receiver.advanced.show')}
            </button>
            {advancedDecodeOpen && (
              <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                <label>
                  <span className="rq-label">{t('receiver.maxSymbols')}</span>
                  <select
                    value={String(decodeSettings.maxSymbols)}
                    className="rq-select"
                    onChange={(e) => {
                      updateDecodeAdvancedField(
                        'maxSymbols',
                        parseMaxSymbolsMode((e.target as HTMLSelectElement).value),
                      );
                    }}
                  >
                    {MAX_SYMBOL_OPTIONS.map((value) => (
                      <option key={String(value)} value={String(value)}>
                        {formatMaxSymbols(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="rq-label">{t('receiver.binarizer')}</span>
                  <select
                    value={decodeSettings.binarizer}
                    className="rq-select"
                    onChange={(e) => {
                      updateDecodePresetField(
                        'binarizer',
                        normalizeBinarizer((e.target as HTMLSelectElement).value),
                      );
                    }}
                  >
                    {BINARIZER_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rq-row">
                  <label className="rq-check">
                    <input
                      type="checkbox"
                      checked={decodeSettings.tryHarder}
                      onChange={(e) => updateDecodePresetField('tryHarder', (e.target as HTMLInputElement).checked)}
                    />
                    tryHarder
                  </label>
                  <label className="rq-check">
                    <input
                      type="checkbox"
                      checked={decodeSettings.tryRotate}
                      onChange={(e) => updateDecodePresetField('tryRotate', (e.target as HTMLInputElement).checked)}
                    />
                    tryRotate
                  </label>
                  <label className="rq-check">
                    <input
                      type="checkbox"
                      checked={decodeSettings.tryInvert}
                      onChange={(e) => updateDecodePresetField('tryInvert', (e.target as HTMLInputElement).checked)}
                    />
                    tryInvert
                  </label>
                  <label className="rq-check">
                    <input
                      type="checkbox"
                      checked={decodeSettings.tryDownscale}
                      onChange={(e) => updateDecodeAdvancedField('tryDownscale', (e.target as HTMLInputElement).checked)}
                    />
                    tryDownscale
                  </label>
                </div>
                <label>
                  <span className="rq-label">{t('receiver.downscaleFactor')}</span>
                  <select
                    value={String(decodeSettings.downscaleFactor)}
                    className="rq-select"
                    disabled={!decodeSettings.tryDownscale}
                    onChange={(e) => {
                      updateDecodeAdvancedField(
                        'downscaleFactor',
                        parseDownscaleFactor((e.target as HTMLSelectElement).value),
                      );
                    }}
                  >
                    {DOWNSCALE_FACTOR_OPTIONS.map((value) => (
                      <option key={value} value={String(value)}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          {(elapsedMs > 0 || throughputKbps > 0) && !scanning && (
            <div className="rq-card rq-summary">
              {t('receiver.transferComplete')}{' '}
              <span className="rq-stat-v">{formatDuration(elapsedMs)}</span>
              {throughputKbps > 0 && (
                <span>
                  {' '}·{' '}{t('receiver.avg')} <span className="rq-stat-v">{throughputKbps.toFixed(1)} KB/s</span>
                </span>
              )}
              <span>
                {' '}·{' '}{t('receiver.data')}{' '}
                <span className="rq-stat-v">
                  {formatBytes(
                    dataLengthRef.current ||
                    (receivedFile?.data.byteLength ?? receivedText.length ?? 0)
                  )}
                </span>
              </span>
            </div>
          )}

          {receivedText && (
            <div className="rq-card" ref={textResultRef}>
              <div className="rq-row-between" style={{ marginBottom: 8 }}>
                <div className="rq-label" style={{ marginBottom: 0 }}>{t('receiver.recoveredText')}</div>
                <button
                  type="button"
                  className="rq-btn-secondary"
                  onClick={handleCopyRecoveredText}
                >
                  {textCopied ? t('receiver.copied') : t('receiver.copyText')}
                </button>
              </div>
              <textarea
                className="rq-textarea"
                value={receivedText}
                readOnly
              />
            </div>
          )}

          {receivedFile && (
            <div className="rq-card" ref={fileResultRef}>
              <div className="rq-card-title">{t('receiver.recoveredFile')}</div>
              <p style={{ margin: '6px 0', fontSize: 14 }}>
                <strong>{t('receiver.file')}</strong> {receivedFile.filename || '(unnamed)'} &middot;{' '}
                {formatBytes(receivedFile.data.byteLength)} &middot;{' '}
                {receivedFile.mime}
              </p>
              <button className="rq-btn" onClick={handleDownload}>
                ⸗ {t('receiver.downloadRecovered')}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard command was rejected.');
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m > 0) return `${m}m${remS.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

function formatDetectedQR(version: number, symbolSize: number): string {
  if (version > 0 && symbolSize > 0) return `V${version} · ${symbolSize} B/frame`;
  if (version > 0) return `V${version}`;
  return 'auto';
}

function formatDetectedFecCodec(value: string): string {
  if (value === 'wasm-raptorq' || value === 'js-rlnc') {
    return formatFecCodec(value);
  }
  return value;
}

function clampScanRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCAN_RATE_FPS;
  return Math.min(MAX_SCAN_RATE_FPS, Math.max(MIN_SCAN_RATE_FPS, Math.round(value)));
}

function scanRateToIntervalMs(fps: number): number {
  return 1000 / clampScanRate(fps);
}

function formatDelayMs(ms: number): string {
  return Number.isInteger(ms) ? String(ms) : ms.toFixed(1);
}

function normalizeDecodePreset(value: string): DecodePresetId {
  return DECODE_PRESET_OPTIONS.includes(value as DecodePresetId)
    ? value as DecodePresetId
    : DEFAULT_DECODE_PRESET;
}

function formatDecodePreset(value: DecodePresetId): string {
  if (value === 'fast') return 'Fast';
  if (value === 'balance') return 'Balance';
  if (value === 'robust') return 'Robust';
  return 'Custom';
}

function parseMaxSymbolsMode(value: string): MaxSymbolsMode {
  if (value === 'auto') return 'auto';
  const parsed = Number(value);
  return parsed === 1 || parsed === 2 || parsed === 4 || parsed === 6 || parsed === 8
    ? parsed
    : DEFAULT_DECODE_SETTINGS.maxSymbols;
}

function formatMaxSymbols(value: MaxSymbolsMode): string {
  return value === 'auto' ? 'Auto (4)' : String(value);
}

function normalizeBinarizer(value: string): QrBinarizer {
  return BINARIZER_OPTIONS.includes(value as QrBinarizer)
    ? value as QrBinarizer
    : DEFAULT_DECODE_SETTINGS.binarizer;
}

function parseDownscaleFactor(value: string): DownscaleFactor {
  const parsed = Number(value);
  return parsed === 2 || parsed === 3 || parsed === 4 ? parsed : DEFAULT_DECODE_SETTINGS.downscaleFactor;
}

function getCameraUnavailableMessage(): string {
  if (!window.isSecureContext) {
    return t('receiver.err.cameraSecure');
  }
  return t('receiver.err.cameraBrowser');
}
