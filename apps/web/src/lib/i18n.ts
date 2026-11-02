/**
 * Lightweight i18n for the RaptorQR web app.
 *
 * Default language: Simplified Chinese (zh). The choice is persisted to
 * localStorage and a `langchange` window event is dispatched so mounted
 * components re-render after the user switches languages.
 *
 * Note: low-level codec enum labels (ECC levels, FEC codec names, QR encoder
 * names, RaptorQ playback names, decode-preset names) are intentionally kept
 * in English because they are international technical terms. All user-facing
 * UI copy (labels, buttons, hints, status, errors, stats) is localized.
 */
import { useState, useEffect } from 'preact/hooks';

export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'raptorqr-lang';

const zh: Record<string, string> = {
  // app nav
  'app.nav.sender': '发送',
  'app.nav.receiver': '接收',

  // common
  'common.retry': '重试',

  // boot
  'boot.preparing': '正在准备离线运行资源，所需的 WASM 文件就绪后应用将自动打开。',
  'boot.runtime': '运行时',

  // sender
  'sender.input.mode': '输入方式',
  'sender.input.file': '文件',
  'sender.input.text': '文本',
  'sender.input.placeholder': '输入或粘贴要传输的文本…',
  'sender.input.chooseFile': '选择文件',
  'sender.input.noFile': '未选择文件',
  'sender.size': '二维码尺寸',
  'sender.ecc': '纠错等级',
  'sender.advanced.show': '高级设置',
  'sender.advanced.hide': '收起高级设置',
  'sender.encoder': '二维码编码器',
  'sender.fec': '前向纠错编码',
  'sender.raptorq.repair': 'RaptorQ 冗余',
  'sender.raptorq.repair.less': '更少码',
  'sender.raptorq.repair.more': '更多冗余',
  'sender.raptorq.playback': 'RaptorQ 播放策略',
  'sender.speed': '播放速度',
  'sender.speed.stable': '稳定',
  'sender.speed.fast': '快速',
  'sender.parallel': '并行二维码',
  'sender.parallel.perTick': '{count} 个/帧',
  'sender.warn.parallel':
    '接收端「自动(4)」每帧最多扫描 4 个二维码。若使用 {n} 个并行二维码，请在接收端高级设置中将「最大符号数」设为 {n}。',
  'sender.start': '开始实时二维码传输',
  'sender.encoding': '正在编码实时二维码…',
  'sender.stop': '停止',
  'sender.live.title': '实时二维码传输',
  'sender.fullscreen': '全屏二维码',
  'sender.prepareGif': '生成 GIF',
  'sender.preparingGif': '正在生成 GIF…',
  'sender.downloadGif': '下载 GIF ({kb} KB)',
  'sender.info.title': '传输信息',
  'sender.info.original': '原始大小',
  'sender.info.preprocessed': '预处理后大小',
  'sender.info.qrVersion': '二维码版本',
  'sender.info.encoder': '二维码编码器',
  'sender.info.payload': '符号载荷',
  'sender.info.fec': '前向纠错编码',
  'sender.info.playback': 'RaptorQ 播放策略',
  'sender.info.packets': '二维码包数',
  'sender.info.parallel': '并行二维码',
  'sender.info.liveSpeed': '实时速度',
  'sender.info.actualFps': '实际帧率',
  'sender.info.renderCache': '二维码渲染缓存',
  'sender.info.gifSpeed': 'GIF 导出速度',
  'sender.info.generations': '生成次数',
  'sender.info.raptorqPackets': 'RaptorQ 包',
  'sender.info.gifSize': 'GIF 大小',
  'sender.info.notApplicable': '不适用（JS RLNC）',
  'sender.info.notRunning': '未运行',
  'sender.info.notPrepared': '未生成',
  'sender.info.preparing': '生成中…',
  'sender.status.running': '实时二维码传输中（{packets} 个数据包，每帧 {parallel} 个）。',
  'sender.status.renderFirst': '正在渲染首帧二维码…',
  'sender.status.encoded': '已编码 {n} 个数据包。正在渲染首帧二维码…',
  'sender.status.gifReady': 'GIF 已就绪。',
  'sender.status.stopped': '已停止。',
  'sender.err.noText': '请输入一些文本。',
  'sender.err.noFile': '请选择一个文件。',
  'sender.err.fileTooLarge': '文件过大，最大支持 8 MB。',
  'sender.err.gifBeforeLive': '请先开始实时二维码传输，再生成 GIF。',
  'sender.err.fullscreenUnsupported': '当前浏览器不支持全屏。',
  'sender.err.fullscreen': '全屏错误：{msg}',

  // receiver
  'receiver.input.mode': '输入方式',
  'receiver.input.camera': '相机',
  'receiver.input.gif': 'GIF 文件',
  'receiver.fec': '前向纠错编码',
  'receiver.decodePreset': '解码预设',
  'receiver.advanced.show': '高级设置',
  'receiver.advanced.hide': '收起高级设置',
  'receiver.maxSymbols': '最大符号数',
  'receiver.binarizer': '二值化器',
  'receiver.tryHarder': '强力尝试',
  'receiver.tryRotate': '尝试旋转',
  'receiver.tryInvert': '尝试反色',
  'receiver.tryDownscale': '尝试降采样',
  'receiver.downscaleFactor': '降采样系数',
  'receiver.camera': '相机',
  'receiver.scanRate': '扫描帧率',
  'receiver.scanRate.stable': '稳定',
  'receiver.scanRate.fast': '快速',
  'receiver.zoom': '变焦：',
  'receiver.hint.zoom': '全帧扫描已启用。仅当二维码过小时使用变焦。',
  'receiver.hint.noZoom': '全帧扫描已启用。',
  'receiver.startScan': '开始扫描',
  'receiver.stopScan': '停止扫描',
  'receiver.scanning': '正在扫描…',
  'receiver.stopped': '已停止',
  'receiver.stat.decoded': '已解码',
  'receiver.stat.unique': '唯一',
  'receiver.stat.useful': '有效',
  'receiver.stat.dupes': '重复',
  'receiver.stat.gens': '代',
  'receiver.stat.qr': '二维码',
  'receiver.stat.fec': '纠错',
  'receiver.stat.decode': '解码',
  'receiver.stat.time': '时间',
  'receiver.stat.speed': '速度',
  'receiver.stat.working': '处理中…',
  'receiver.uploadGif': '上传 GIF',
  'receiver.uploadGif.desc': '上传由发送端生成的 RaptorQR 文件。',
  'receiver.chooseGif': '选择 GIF',
  'receiver.noGif': '未选择 GIF',
  'receiver.processingGif': '正在处理 GIF…',
  'receiver.parsingGif': '正在解析 GIF 帧…',
  'receiver.processingFrames': '正在处理 {n} 帧…',
  'receiver.gifProcessed': 'GIF 处理完成',
  'receiver.complete': '完成 ✓',
  'receiver.transferComplete': '传输完成 —',
  'receiver.avg': '平均',
  'receiver.data': '数据',
  'receiver.recoveredText': '已恢复文本',
  'receiver.copyText': '复制文本',
  'receiver.copied': '已复制',
  'receiver.recoveredFile': '已恢复文件',
  'receiver.file': '文件：',
  'receiver.downloadRecovered': '下载已恢复文件',
  'receiver.err.noFrames': 'GIF 中未找到帧',
  'receiver.err.camera': '相机错误：{msg}',
  'receiver.err.gif': 'GIF 错误：{msg}',
  'receiver.err.copyFailed': '复制失败：{msg}',
  'receiver.err.worker': '工作线程错误：{msg}',
  'receiver.err.cameraSecure':
    '相机 API 不可用：当前页面不在安全上下文中。请使用 HTTPS、localhost，或上传 GIF 代替。',
  'receiver.err.cameraBrowser':
    '当前浏览器不可用相机 API。请使用较新的 Chrome/Safari/Edge，或上传 GIF 代替。',
};

const en: Record<string, string> = {
  'app.nav.sender': 'Sender',
  'app.nav.receiver': 'Receiver',
  'common.retry': 'Retry',
  'boot.preparing':
    'Preparing runtime assets for offline use. The app will open after the required WASM files are ready.',
  'boot.runtime': 'runtime',
  'sender.input.mode': 'Input mode',
  'sender.input.file': 'File',
  'sender.input.text': 'Text',
  'sender.input.placeholder': 'Type or paste text to transfer…',
  'sender.input.chooseFile': 'Choose file',
  'sender.input.noFile': 'No file selected',
  'sender.size': 'QR size',
  'sender.ecc': 'QR ECC',
  'sender.advanced.show': 'Advanced settings',
  'sender.advanced.hide': 'Hide advanced settings',
  'sender.encoder': 'QR encoder',
  'sender.fec': 'FEC codec',
  'sender.raptorq.repair': 'RaptorQ repair',
  'sender.raptorq.repair.less': 'Less QR',
  'sender.raptorq.repair.more': 'More repair',
  'sender.raptorq.playback': 'RaptorQ playback',
  'sender.speed': 'QR speed',
  'sender.speed.stable': 'Stable',
  'sender.speed.fast': 'Fast',
  'sender.parallel': 'Parallel QR',
  'sender.parallel.perTick': '{count} QR per tick',
  'sender.warn.parallel':
    'Receiver Auto (4) scans up to 4 QR codes per frame. For {n} parallel QR, set Receiver advanced settings - Max symbols to {n}.',
  'sender.start': 'Start Live QR',
  'sender.encoding': 'Encoding live QR…',
  'sender.stop': 'Stop',
  'sender.live.title': 'Live QR Transfer',
  'sender.fullscreen': 'Fullscreen QR',
  'sender.prepareGif': 'Prepare GIF',
  'sender.preparingGif': 'Preparing GIF export…',
  'sender.downloadGif': 'Download GIF ({kb} KB)',
  'sender.info.title': 'Transfer Info',
  'sender.info.original': 'Original size',
  'sender.info.preprocessed': 'Preprocessed size',
  'sender.info.qrVersion': 'QR size',
  'sender.info.encoder': 'QR encoder',
  'sender.info.payload': 'Symbol payload',
  'sender.info.fec': 'FEC codec',
  'sender.info.playback': 'RaptorQ playback',
  'sender.info.packets': 'QR packets',
  'sender.info.parallel': 'Parallel QR',
  'sender.info.liveSpeed': 'Live speed',
  'sender.info.actualFps': 'Actual live fps',
  'sender.info.renderCache': 'QR render cache',
  'sender.info.gifSpeed': 'GIF export speed',
  'sender.info.generations': 'Generations',
  'sender.info.raptorqPackets': 'RaptorQ packets',
  'sender.info.gifSize': 'GIF size',
  'sender.info.notApplicable': 'Not applicable (JS RLNC)',
  'sender.info.notRunning': 'Not running',
  'sender.info.notPrepared': 'Not prepared',
  'sender.info.preparing': 'Preparing…',
  'sender.status.running': 'Live QR running ({packets} packets, {parallel} per tick).',
  'sender.status.renderFirst': 'Rendering first QR frame…',
  'sender.status.encoded': 'Encoded {n} packets. Rendering first QR frame…',
  'sender.status.gifReady': 'GIF ready.',
  'sender.status.stopped': 'Stopped.',
  'sender.err.noText': 'Please enter some text.',
  'sender.err.noFile': 'Please select a file.',
  'sender.err.fileTooLarge': 'File too large. Maximum size is 8 MB.',
  'sender.err.gifBeforeLive': 'Start a live QR transfer before preparing a GIF.',
  'sender.err.fullscreenUnsupported': 'Fullscreen is not supported in this browser.',
  'sender.err.fullscreen': 'Fullscreen error: {msg}',
  'receiver.input.mode': 'Input Mode',
  'receiver.input.camera': 'Camera',
  'receiver.input.gif': 'GIF File',
  'receiver.fec': 'FEC codec',
  'receiver.decodePreset': 'Decode preset',
  'receiver.advanced.show': 'Advanced settings',
  'receiver.advanced.hide': 'Hide advanced settings',
  'receiver.maxSymbols': 'Max symbols',
  'receiver.binarizer': 'Binarizer',
  'receiver.tryHarder': 'tryHarder',
  'receiver.tryRotate': 'tryRotate',
  'receiver.tryInvert': 'tryInvert',
  'receiver.tryDownscale': 'tryDownscale',
  'receiver.downscaleFactor': 'Downscale factor',
  'receiver.camera': 'Camera',
  'receiver.scanRate': 'Scan rate',
  'receiver.scanRate.stable': 'Stable',
  'receiver.scanRate.fast': 'Fast',
  'receiver.zoom': 'Zoom:',
  'receiver.hint.zoom':
    'Full-frame scan is active. Use Zoom only if the QR codes are too small.',
  'receiver.hint.noZoom': 'Full-frame scan is active.',
  'receiver.startScan': 'Start Scan',
  'receiver.stopScan': 'Stop Scan',
  'receiver.scanning': 'Scanning…',
  'receiver.stopped': 'Stopped',
  'receiver.stat.decoded': 'decoded',
  'receiver.stat.unique': 'unique',
  'receiver.stat.useful': 'useful',
  'receiver.stat.dupes': 'dupes',
  'receiver.stat.gens': 'gens',
  'receiver.stat.qr': 'QR',
  'receiver.stat.fec': 'FEC',
  'receiver.stat.decode': 'decode',
  'receiver.stat.time': 'time',
  'receiver.stat.speed': 'speed',
  'receiver.stat.working': 'Working…',
  'receiver.uploadGif': 'Upload GIF',
  'receiver.uploadGif.desc': 'Upload a RaptorQR file generated by the Sender.',
  'receiver.chooseGif': 'Choose GIF',
  'receiver.noGif': 'No GIF selected',
  'receiver.processingGif': 'Processing GIF…',
  'receiver.parsingGif': 'Parsing GIF frames…',
  'receiver.processingFrames': 'Processing {n} frames…',
  'receiver.gifProcessed': 'GIF processed',
  'receiver.complete': 'Complete ✓',
  'receiver.transferComplete': 'Transfer complete —',
  'receiver.avg': 'avg',
  'receiver.data': 'data',
  'receiver.recoveredText': 'Recovered Text',
  'receiver.copyText': 'Copy text',
  'receiver.copied': 'Copied',
  'receiver.recoveredFile': 'Recovered File',
  'receiver.file': 'File:',
  'receiver.downloadRecovered': 'Download Recovered File',
  'receiver.err.noFrames': 'No frames found in GIF',
  'receiver.err.camera': 'Camera error: {msg}',
  'receiver.err.gif': 'GIF error: {msg}',
  'receiver.err.copyFailed': 'Copy failed: {msg}',
  'receiver.err.worker': 'Worker error: {msg}',
  'receiver.err.cameraSecure':
    'Camera API is unavailable because this page is not in a secure context. Use HTTPS, localhost, or upload a GIF instead.',
  'receiver.err.cameraBrowser':
    'Camera API is unavailable in this browser. Try a recent Chrome/Safari/Edge browser, or upload a GIF instead.',
};

const dict: Record<Lang, Record<string, string>> = { zh, en };

let current: Lang = 'zh';
try {
  const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
  if (stored === 'zh' || stored === 'en') current = stored;
} catch {
  // localStorage may be unavailable (private mode); fall back to default.
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore storage errors
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('langchange'));
  }
}

/**
 * Translate a key, optionally interpolating `{var}` placeholders.
 * Falls back to the English string, then to the key itself.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const table = dict[current] ?? en;
  let str = table[key] ?? en[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      str = str.split('{' + k + '}').join(String(vars[k]));
    }
  }
  return str;
}

/** Subscribe a component to language changes so it re-renders on switch. */
export function useLang(): Lang {
  const [lang, setLangState] = useState<Lang>(current);
  useEffect(() => {
    const handler = () => setLangState(current);
    window.addEventListener('langchange', handler);
    return () => window.removeEventListener('langchange', handler);
  }, []);
  return lang;
}
