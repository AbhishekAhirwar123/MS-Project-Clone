import { useEffect, useState } from 'react';
import App from './App';
import ProjectsHome from './views/ProjectsHome';
import { LoginPage, OfflinePage, TemporaryPasswordPage } from './views/Login';
import { loadSession, runAfterSignIn, useAuth } from './auth';
import { lastProjectId, useStore } from './store';

// Everything behind "Open the app": sign-in, the projects page, and the planner for the open project.
export default function Workspace() {
  const status = useAuth(s => s.status);
  const user = useAuth(s => s.user);
  const project = useStore(s => s.project);
  const [reopening, setReopening] = useState(true);

  useEffect(() => { if (useAuth.getState().status === 'loading') void loadSession(); }, []);

  // Once signed in: reopen the project you had open last time, then run anything queued (share link, sample).
  const ready = status === 'signedIn' && !!user && !user.mustChangePassword;
  useEffect(() => {
    if (!ready) return;
    const id = lastProjectId();
    const reopen = id && !useStore.getState().project ? useStore.getState().openProject(id, true) : Promise.resolve(false);
    void reopen.finally(() => { setReopening(false); runAfterSignIn(); });
  }, [ready]);

  // Signing out closes whatever was open.
  useEffect(() => { if (status === 'signedOut' && useStore.getState().project) useStore.setState({ project: null }); }, [status]);

  if (status === 'loading') return <div className="auth-page"><p className="muted">Loading…</p></div>;
  if (status === 'offline') return <OfflinePage />;
  if (status === 'signedOut' || !user) return <LoginPage />;
  if (user.mustChangePassword) return <TemporaryPasswordPage />;
  if (project) return <App />;
  if (reopening) return <div className="auth-page"><p className="muted">Opening your last project…</p></div>;
  return <ProjectsHome />;
}
