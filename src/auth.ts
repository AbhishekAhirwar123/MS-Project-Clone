import { create } from 'zustand';
import { api, ApiError, setSignedOutHandler, type User } from './lib/api';

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn' | 'offline';
  user: User | null;
  message: string;
}

export const useAuth = create<AuthState>(() => ({ status: 'loading', user: null, message: '' }));
export const currentUser = () => useAuth.getState().user;

export async function loadSession() {
  try {
    const { user } = await api<{ user: User }>('GET', '/auth/me');
    useAuth.setState({ status: 'signedIn', user, message: '' });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) useAuth.setState({ status: 'signedOut', user: null, message: '' });
    else useAuth.setState({ status: 'offline', user: null, message: (e as Error).message });
  }
}

export async function signIn(email: string, password: string) {
  const { user } = await api<{ user: User }>('POST', '/auth/login', { email, password });
  useAuth.setState({ status: 'signedIn', user, message: '' });
}

export async function signOut() {
  try { await api('POST', '/auth/logout'); } catch { /* the cookie is cleared or already expired */ }
  useAuth.setState({ status: 'signedOut', user: null, message: '' });
}

export async function changePassword(current: string, next: string) {
  const { user } = await api<{ user: User }>('POST', '/auth/password', { current, next });
  useAuth.setState({ user });
}

// Something to do once the user is signed in (and has replaced a temporary password), e.g. open a share link.
let afterSignIn: (() => void) | null = null;
const ready = () => useAuth.getState().status === 'signedIn' && !useAuth.getState().user?.mustChangePassword;
export function whenSignedIn(fn: () => void) { if (ready()) fn(); else afterSignIn = fn; }
export function runAfterSignIn() {
  if (!ready() || !afterSignIn) return;
  const fn = afterSignIn;
  afterSignIn = null;
  fn();
}

setSignedOutHandler(() => useAuth.setState({ status: 'signedOut', user: null, message: 'Your session ended. Please sign in again.' }));
