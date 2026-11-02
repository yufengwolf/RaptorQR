/**
 * App shell — top-level layout with hash-based tab navigation.
 */
import { useState, useEffect } from 'preact/hooks';
import { t, setLang, useLang } from '@/lib/i18n';
import { SenderPage } from '@/app/routes/sender';
import { ReceiverPage } from '@/app/routes/receiver';

type Tab = 'sender' | 'receiver';

function getTabFromHash(): Tab {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'receiver') return 'receiver';
  return 'sender';
}

/**
 * Global design system. Injected once at the app root so the sender/receiver
 * pages can rely on shared CSS variables, a responsive two-column grid, and
 * polished component classes (cards, buttons, selects, range sliders, …).
 */
const GLOBAL_CSS = `
:root {
  --bg: #0a0e14;
  --surface: #141b26;
  --surface-2: #1b2433;
  --border: rgba(255,255,255,.08);
  --border-2: rgba(255,255,255,.14);
  --text: #e6edf3;
  --muted: #93a1b0;
  --faint: #6b7785;
  --accent: #6d8bff;
  --accent-2: #36d6c3;
  --grad: linear-gradient(135deg, #6d8bff 0%, #36d6c3 100%);
  --success: #3fb950;
  --danger: #f0556a;
  --warn-bg: #2a2310;
  --warn-bd: #6b5410;
  --warn-tx: #e8b84b;
  --radius: 16px;
  --radius-sm: 11px;
  --shadow: 0 12px 36px rgba(0,0,0,.45);
  --shadow-sm: 0 6px 18px rgba(0,0,0,.35);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background:
    radial-gradient(1200px 700px at 50% -15%, #162032 0%, transparent 60%),
    radial-gradient(900px 520px at 100% 0%, #14233a 0%, transparent 55%),
    radial-gradient(900px 520px at 0% 0%, #14233a 0%, transparent 55%),
    var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
::-webkit-scrollbar { width: 12px; height: 12px; }
::-webkit-scrollbar-thumb { background: #28323f; border-radius: 8px; border: 3px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: #36465a; background-clip: content-box; }

/* ── Layout ───────────────────────────────────────────────────────────── */
.rq-shell { min-height: 100vh; display: flex; flex-direction: column; }
.rq-header {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 20px;
  padding: 14px 28px;
  background: rgba(10,14,20,.72);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
}
.rq-logo {
  font-size: 20px; font-weight: 800; letter-spacing: -.4px;
  background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent;
  display: flex; align-items: center; gap: 9px;
}
.rq-main { max-width: 1280px; width: 100%; margin: 0 auto; padding: 36px 32px 72px; box-sizing: border-box; }
@media (max-width: 960px) { .rq-main { padding: 22px 16px 48px; } }
.rq-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.05fr); gap: 22px; align-items: start; }
@media (max-width: 980px) { .rq-grid { grid-template-columns: 1fr; gap: 18px; } }
.rq-col { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

/* ── Card ────────────────────────────────────────────────────────────── */
.rq-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 22px; box-shadow: var(--shadow-sm);
}
.rq-card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .9px; color: var(--faint); margin-bottom: 16px; }
.rq-summary { padding: 14px 20px; font-size: 13px; color: var(--muted); }

/* ── Labels & rows ───────────────────────────────────────────────────── */
.rq-label { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: var(--faint); margin-bottom: 8px; }
.rq-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.rq-row-between { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.rq-hint { font-size: 12px; color: var(--muted); margin-top: 10px; }

/* ── Buttons ─────────────────────────────────────────────────────────── */
.rq-btn, .rq-btn-secondary, .rq-btn-stop {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border-radius: var(--radius-sm); font-weight: 700; cursor: pointer; font-size: 15px;
  border: none; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease, background .12s ease;
}
.rq-btn { padding: 11px 26px; background: var(--grad); color: #fff; box-shadow: 0 8px 22px rgba(109,139,255,.35); }
.rq-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(109,139,255,.5); }
.rq-btn:disabled { opacity: .55; cursor: not-allowed; }
.rq-btn-secondary { padding: 11px 22px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border-2); }
.rq-btn-secondary:hover:not(:disabled) { border-color: var(--accent); color: #fff; background: #1f2a3a; }
.rq-btn-secondary:disabled { opacity: .5; cursor: not-allowed; }
.rq-btn-stop { padding: 11px 22px; background: var(--danger); color: #fff; }
.rq-btn-stop:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(240,85,106,.4); }

/* ── Toggle group ────────────────────────────────────────────────────── */
.rq-toggle { display: flex; gap: 4px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 4px; }
.rq-toggle-btn { padding: 8px 16px; border: none; border-radius: 9px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s; }
.rq-toggle-btn.active { background: var(--grad); color: #fff; box-shadow: 0 4px 12px rgba(109,139,255,.35); }

/* ── Select & textarea ───────────────────────────────────────────────── */
.rq-select {
  width: 100%; background: var(--surface-2); color: var(--text);
  border: 1px solid var(--border-2); border-radius: var(--radius-sm);
  padding: 11px 38px 11px 12px; font-size: 14px; cursor: pointer;
  appearance: none; -webkit-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2393a1b0' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>");
  background-repeat: no-repeat; background-position: right 12px center;
  transition: border-color .12s, box-shadow .12s;
}
.rq-select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(109,139,255,.22); }
.rq-select option { background: #1b2433; color: var(--text); }
.rq-textarea {
  width: 100%; box-sizing: border-box; background: var(--surface-2); color: var(--text);
  border: 1px solid var(--border-2); border-radius: var(--radius-sm); padding: 14px;
  font-size: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  resize: vertical; min-height: 150px; line-height: 1.5;
  transition: border-color .12s, box-shadow .12s;
}
.rq-textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(109,139,255,.22); }

/* ── Range slider ────────────────────────────────────────────────────── */
.rq-range { -webkit-appearance: none; appearance: none; width: 100%; height: 7px; border-radius: 6px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); outline: none; }
.rq-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #fff; border: 4px solid var(--accent); cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.45); transition: transform .12s; }
.rq-range::-webkit-slider-thumb:hover { transform: scale(1.12); }
.rq-range::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 4px solid var(--accent); cursor: pointer; }
.rq-slider-labels { display: flex; justify-content: space-between; color: var(--faint); font-size: 12px; margin-top: 6px; }

/* ── Warn / status banners ───────────────────────────────────────────── */
.rq-warn { background: var(--warn-bg); border: 1px solid var(--warn-bd); color: var(--warn-tx); border-radius: 11px; padding: 11px 14px; font-size: 13px; margin-top: 10px; line-height: 1.5; }
.rq-status { margin-top: 12px; padding: 10px 14px; border-radius: 11px; background: rgba(109,139,255,.12); border: 1px solid rgba(109,139,255,.3); color: #cdd9ff; font-size: 14px; }

/* ── Info grid (stats) ───────────────────────────────────────────────── */
.rq-info { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; }
.rq-info-cell { display: flex; flex-direction: column; gap: 3px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.rq-info-k { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--faint); }
.rq-info-v { font-size: 14px; color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }

/* ── Stats bar (receiver inline) ─────────────────────────────────────── */
.rq-stats { display: flex; gap: 8px 18px; align-items: center; font-size: 12px; color: var(--muted); margin-top: 12px; flex-wrap: wrap; }
.rq-stat-v { color: var(--text); font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }

/* ── Misc ────────────────────────────────────────────────────────────── */
.rq-filename { color: var(--text); font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rq-check { display: inline-flex; align-items: center; gap: 7px; color: var(--text); font-size: 13px; cursor: pointer; }
.rq-check input { width: 16px; height: 16px; accent-color: var(--accent); }
.rq-hidden { display: none; }
.rq-video { width: 100%; max-width: 560px; border-radius: 12px; background: #000; display: block; margin-top: 4px; }

/* ── QR stage (sender live preview) ──────────────────────────────────── */
.rq-stage { background: #fff; border-radius: var(--radius); padding: 18px; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow); position: relative; overflow: hidden; }
.rq-stage-canvas { image-rendering: pixelated; -webkit-image-rendering: pixelated; max-width: 100%; display: block; border-radius: 8px; }
.rq-stage-fullscreen { width: 100vw; height: 100vh; border-radius: 0; padding: 0; box-shadow: none; position: fixed; top: 0; left: 0; z-index: 9999; }
.rq-stage-fullscreen .rq-stage-canvas { width: 100%; height: 100%; object-fit: contain; }
.rq-stage-empty { align-items: center; justify-content: center; min-height: 340px; border: 2px dashed var(--border-2); background: repeating-linear-gradient(45deg, #10161f, #10161f 12px, #131a24 12px, #131a24 24px); box-shadow: none; }
.rq-stage-hint { color: var(--faint); font-size: 14px; text-align: center; padding: 0 24px; }

/* ── Spinner ─────────────────────────────────────────────────────────── */
.rq-spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; border-radius: 50%; animation: rq-spin .8s linear infinite; display: inline-block; vertical-align: middle; margin-right: 8px; }
@keyframes rq-spin { to { transform: rotate(360deg); } }

/* ── Tabs & language ─────────────────────────────────────────────────── */
.rq-tabs { display: flex; gap: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 4px; }
.rq-tab { padding: 8px 18px; border-radius: 9px; border: none; background: transparent; color: var(--muted); font-size: 14px; font-weight: 600; cursor: pointer; transition: all .15s; }
.rq-tab.active { background: var(--grad); color: #fff; box-shadow: 0 4px 12px rgba(109,139,255,.35); }
.rq-lang { display: flex; gap: 4px; margin-left: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 3px; }
.rq-lang-btn { padding: 5px 12px; border: none; border-radius: 8px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 700; cursor: pointer; transition: all .15s; }
.rq-lang-btn.active { background: var(--accent); color: #fff; }
`;

export function App() {
  const [tab, setTab] = useState<Tab>(getTabFromHash);
  const lang = useLang();

  useEffect(() => {
    const onHashChange = () => setTab(getTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (t: Tab) => {
    window.location.hash = t;
    setTab(t);
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="rq-shell">
        <header className="rq-header">
          <span className="rq-logo">◈ RaptorQR</span>
          <nav className="rq-tabs">
            <button
              className={tab === 'sender' ? 'rq-tab active' : 'rq-tab'}
              onClick={() => navigate('sender')}
            >
              📤 {t('app.nav.sender')}
            </button>
            <button
              className={tab === 'receiver' ? 'rq-tab active' : 'rq-tab'}
              onClick={() => navigate('receiver')}
            >
              📥 {t('app.nav.receiver')}
            </button>
          </nav>
          <span className="rq-lang">
            <button
              className={lang === 'zh' ? 'rq-lang-btn active' : 'rq-lang-btn'}
              onClick={() => setLang('zh')}
            >
              中
            </button>
            <button
              className={lang === 'en' ? 'rq-lang-btn active' : 'rq-lang-btn'}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </span>
        </header>
        <main className="rq-main">
          {tab === 'sender' ? <SenderPage /> : <ReceiverPage />}
        </main>
      </div>
    </>
  );
}
