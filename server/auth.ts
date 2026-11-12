import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ObjectId } from 'mongodb';
import { col, type UserDoc } from './db.js';
import { HttpError, forbidden } from './http.js';
import type { Role } from '../shared/roles.js';

export const COOKIE = 'neo_session';
const SESSION_DAYS = 7;
const MAX_FAILED_LOGINS = 5, LOCK_MINUTES = 15;

interface AuthedRequest extends Request { user: UserDoc }

// The signed-in user, set by requireUser.
export const userOf = (req: Request<any>): UserDoc => (req as unknown as AuthedRequest).user;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const secureCookies = () => process.env.NODE_ENV === 'production';

export function publicUser(u: UserDoc) {
  return { id: String(u._id), email: u.email, name: u.name, role: u.role, active: u.active, mustChangePassword: u.mustChangePassword, createdAt: u.createdAt };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export async function startSession(res: Response, userId: ObjectId) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date(), expiresAt = new Date(now.getTime() + SESSION_DAYS * 864e5);
  await (await col.sessions()).insertOne({ _id: sha256(token), userId, createdAt: now, expiresAt });
  res.cookie(COOKIE, token, { httpOnly: true, secure: secureCookies(), sameSite: 'strict', path: '/', expires: expiresAt });
}

export async function endSession(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) await (await col.sessions()).deleteOne({ _id: sha256(token) });
  res.clearCookie(COOKIE, { httpOnly: true, secure: secureCookies(), sameSite: 'strict', path: '/' });
}

// Signs a user out everywhere, for example after a password reset or when the account is deactivated.
export async function endAllSessions(userId: ObjectId, exceptReq?: Request) {
  const keep = exceptReq && readCookie(exceptReq, COOKIE);
  await (await col.sessions()).deleteMany(keep ? { userId, _id: { $ne: sha256(keep) } } : { userId });
}

async function currentUser(req: Request): Promise<UserDoc | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const session = await (await col.sessions()).findOne({ _id: sha256(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const user = await (await col.users()).findOne({ _id: session.userId });
  return user && user.active ? user : null;
}

// Requires a signed-in, active user. The role is read fresh on every request, so role changes apply at once.
export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Please sign in.');
  // Until a temporary password is replaced, only the account endpoints work.
  if (user.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) throw new HttpError(403, 'Change your temporary password first.', { mustChangePassword: true });
  (req as unknown as AuthedRequest).user = user;
  next();
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!roles.includes(userOf(req).role)) throw forbidden();
  next();
};

/* ---------- failed-login lockout (stored in MongoDB, so it works across serverless instances) ---------- */

export async function checkLockout(emailAddr: string) {
  const a = await (await col.loginAttempts()).findOne({ _id: emailAddr });
  if (a && a.count >= MAX_FAILED_LOGINS && a.expiresAt > new Date()) {
    throw new HttpError(429, 'Too many failed sign-in attempts. Try again in ' + LOCK_MINUTES + ' minutes.');
  }
}

export async function recordFailedLogin(emailAddr: string) {
  const attempts = await col.loginAttempts();
  const expiresAt = new Date(Date.now() + LOCK_MINUTES * 60e3);
  await attempts.updateOne({ _id: emailAddr }, { $inc: { count: 1 }, $set: { expiresAt } }, { upsert: true });
}

export async function clearFailedLogins(emailAddr: string) {
  await (await col.loginAttempts()).deleteOne({ _id: emailAddr });
}
