import { Component, StrictMode, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import OP from './core';
import DialogHost from './components/Dialogs';
import { Toast } from './components/Toast';
import { useStore, S, ask } from './store';
import { handleLaunchFiles } from './lib/actions';
import { SHARE_PREFIX, decodePlan } from './lib/share';
import './styles.css';

const W = window as any;

// Opens a plan carried in a share link, after asking, and removes the plan data from the address bar.
async function openSharedPlan() {
  if (!location.hash.startsWith(SHARE_PREFIX)) return;
  const data = location.hash.slice(SHARE_PREFIX.length);
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const p = await decodePlan(data);
    ask('Open a copy of the shared plan “' + p.name + '”? Your current plan can be restored from File › Open › Restore Previous Project.', () => {
      S().replaceProject(p, 'Shared plan opened');
      location.hash = 'app';
    }, 'Open plan');
  } catch {
    S().toast('This share link is incomplete or damaged. Ask for the link again, or for the .neoproject file.', true);
  }
}
const loadApp = () => import('./App');
const App = lazy(loadApp);
const Landing = lazy(() => import('./views/Landing'));

function Root() {
  const [inApp, setInApp] = useState(location.hash === '#app');
  const theme = useStore(s => s.theme);
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => {
    const onHash = () => { openSharedPlan(); setInApp(location.hash === '#app'); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // Fetch the planner in the background so "Open the app" is instant.
  useEffect(() => { if (!inApp) { const t = setTimeout(loadApp, 1500); return () => clearTimeout(t); } }, [inApp]);
  return <>
    <Suspense fallback={null}>{inApp ? <App /> : <Landing />}</Suspense>
    <DialogHost />
    <Toast />
  </>;
}

// Shows recovery options instead of a blank page when rendering fails.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const resetView = () => { try { localStorage.removeItem('neoproject.ui'); } catch { /* storage unavailable */ } location.reload(); };
    const backup = () => {
      let text = '';
      try { text = localStorage.getItem('neoproject.project') || ''; } catch { /* storage unavailable */ }
      if (text) OP.util.download('neoproject-backup.neoproject', text, 'application/x-neoproject');
    };
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>Neo Project hit an error: {this.state.error.message}</p>
        <p>Your project is still saved in this browser. Download a backup copy, then reset the view settings and reload.</p>
        <div className="crash-actions">
          <button className="btn" onClick={backup}>Download project backup</button>
          <button className="btn primary" onClick={resetView}>Reset view settings</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>
);
handleLaunchFiles();
openSharedPlan();
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ }); });
}
