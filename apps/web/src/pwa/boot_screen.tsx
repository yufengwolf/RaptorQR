import type { PreloadProgress } from './preload';
import { t } from '@/lib/i18n';

type CSSProps = Record<string, string | number>;

interface BootScreenProps {
  error: string;
  progress: PreloadProgress;
  onRetry: () => void;
}

const S = {
  page: {
    minHeight: '100vh',
    background:
      'radial-gradient(1200px 700px at 50% -15%, #162032 0%, transparent 60%), radial-gradient(900px 520px at 100% 0%, #14233a 0%, transparent 55%), radial-gradient(900px 520px at 0% 0%, #14233a 0%, transparent 55%), #0a0e14',
    color: '#f0f6fc',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  } as CSSProps,
  panel: {
    width: 'min(440px, 100%)',
  } as CSSProps,
  title: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 8,
  } as CSSProps,
  body: {
    color: '#8b949e',
    fontSize: 15,
    lineHeight: 1.5,
    marginBottom: 22,
  } as CSSProps,
  progressShell: {
    width: '100%',
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
    background: '#21262d',
    border: '1px solid #30363d',
  } as CSSProps,
  progressFill: (percent: number): CSSProps => ({
    width: `${percent}%`,
    height: '100%',
    background: 'linear-gradient(90deg, #6d8bff 0%, #36d6c3 100%)',
    transition: 'width 160ms ease',
  }),
  meta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 10,
    color: '#8b949e',
    fontSize: 13,
  } as CSSProps,
  error: {
    marginTop: 16,
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #bb8009',
    background: '#3d2600',
    color: '#d29922',
    fontSize: 13,
  } as CSSProps,
  button: {
    marginTop: 14,
    background: '#238636',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '9px 18px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  } as CSSProps,
};

export function BootScreen({ error, progress, onRetry }: BootScreenProps) {
  const percent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <main style={S.page}>
      <section style={S.panel} aria-label="RaptorQR startup">
        <h1 style={S.title}>RaptorQR</h1>
        <p style={S.body}>
          {t('boot.preparing')}
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={S.progressShell}
        >
          <div style={S.progressFill(percent)} />
        </div>
        <div style={S.meta}>
          <span>{t('boot.runtime')}</span>
          <span>{percent}%</span>
        </div>
        {error && (
          <>
            <div style={S.error}>{error}</div>
            <button type="button" style={S.button} onClick={onRetry}>
              {t('common.retry')}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
