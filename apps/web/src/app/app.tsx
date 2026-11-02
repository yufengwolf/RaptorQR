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

const styles: Record<string, Record<string, string | number>> = {
  container: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#0d1117',
    color: '#c9d1d9',
    minHeight: '100vh',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    background: '#161b22',
    borderBottom: '1px solid #30363d',
    padding: '12px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 24,
  },
  logo: {
    fontSize: 18,
    fontWeight: 700,
    color: '#58a6ff',
    letterSpacing: -0.5,
  },
  tabBar: {
    display: 'flex',
    gap: 4,
  },
  tab: {
    padding: '8px 20px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    background: 'transparent',
    color: '#8b949e',
    transition: 'all 0.15s',
  },
  tabActive: {
    background: '#1f2937',
    color: '#f0f6fc',
  },
  langToggle: {
    display: 'flex',
    gap: 4,
    marginLeft: 'auto',
    background: '#0d1117',
    borderRadius: 6,
    padding: 2,
  },
  langBtn: {
    padding: '4px 10px',
    borderRadius: 4,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    background: 'transparent',
    color: '#8b949e',
  },
  langActive: {
    background: '#1f2937',
    color: '#f0f6fc',
  },
  main: {
    flex: 1,
    padding: '24px',
    maxWidth: 960,
    width: '100%',
    margin: '0 auto',
    boxSizing: 'border-box' as const,
  },
};

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
    <div style={styles.container}>
      <header style={styles.header}>
        <span style={styles.logo}>◈ RaptorQR</span>
        <nav style={styles.tabBar}>
          <button
            style={{ ...styles.tab, ...(tab === 'sender' ? styles.tabActive : {}) }}
            onClick={() => navigate('sender')}
          >
            📤 {t('app.nav.sender')}
          </button>
          <button
            style={{ ...styles.tab, ...(tab === 'receiver' ? styles.tabActive : {}) }}
            onClick={() => navigate('receiver')}
          >
            📥 {t('app.nav.receiver')}
          </button>
        </nav>
        <span style={styles.langToggle}>
          <button
            style={{ ...styles.langBtn, ...(lang === 'zh' ? styles.langActive : {}) }}
            onClick={() => setLang('zh')}
          >
            中
          </button>
          <button
            style={{ ...styles.langBtn, ...(lang === 'en' ? styles.langActive : {}) }}
            onClick={() => setLang('en')}
          >
            EN
          </button>
        </span>
      </header>
      <main style={styles.main}>
        {tab === 'sender' ? <SenderPage /> : <ReceiverPage />}
      </main>
    </div>
  );
}
