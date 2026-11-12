import { useState } from 'react';
import { loadSession, signIn, signOut, useAuth } from '../auth';
import { PasswordForm } from '../components/AccountDialogs';

function AuthPage({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <a className="auth-brand" href="#"><img src="./assets/logo.png" alt="" width={28} height={28} />Neo Project</a>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const message = useAuth(s => s.message);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await signIn(String(fd.get('email')), String(fd.get('password')));
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <AuthPage title="Sign in" sub="Use the account your administrator created for you.">
      {message && !error && <p className="alert info inline">{message}</p>}
      <form className="auth-form" onSubmit={submit}>
        <label className="field"><span>Email</span><input className="inp" name="email" type="email" autoComplete="username" required autoFocus /></label>
        <label className="field"><span>Password</span><input className="inp" name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="alert inline" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="muted small">Forgot your password? Ask an admin to reset it.</p>
    </AuthPage>
  );
}

export function TemporaryPasswordPage() {
  const user = useAuth(s => s.user);
  return (
    <AuthPage title="Choose your password" sub={'Welcome, ' + (user?.name || '') + '. Your account has a temporary password; replace it with one only you know.'}>
      <PasswordForm temporary onDone={() => { /* the auth store now has mustChangePassword: false */ }} />
      <button className="btn ghost" type="button" onClick={() => void signOut()}>Sign out</button>
    </AuthPage>
  );
}

export function OfflinePage() {
  const message = useAuth(s => s.message);
  return (
    <AuthPage title="Can't reach the server" sub={message}>
      <button className="btn primary" type="button" onClick={() => { useAuth.setState({ status: 'loading' }); void loadSession(); }}>Try again</button>
    </AuthPage>
  );
}
