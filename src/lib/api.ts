import type { Access, Role, ShareAccess } from '../../shared/roles';

// Calls to the Neo Project API (server/). The session lives in an httpOnly cookie, so no token is handled here.

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any = null) { super(message); }
}

let onSignedOut: (() => void) | null = null;
export function setSignedOutHandler(fn: () => void) { onSignedOut = fn; }

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: opts.keepalive
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // The session expired or was ended (password reset, account deactivated): go back to the sign-in page.
    if (res.status === 401 && !path.startsWith('/auth/')) onSignedOut?.();
    throw new ApiError(res.status, data?.error || 'The server returned an error (' + res.status + ').', data);
  }
  return data as T;
}

export interface User { id: string; email: string; name: string; role: Role; active: boolean; mustChangePassword: boolean; createdAt: string }
export interface DirectoryUser { id: string; name: string; email: string; role: Role }
export interface ProjectMember { userId: string; access: ShareAccess; name: string; email: string; role?: Role; active: boolean }
export interface ProjectSummary {
  id: string; name: string; access: Access; version: number; updatedAt: string; createdAt: string;
  owner: { id: string; name: string }; updatedBy: string; members: ProjectMember[];
}
export interface VersionInfo { id: string; name: string; createdAt: string; createdBy: string }
