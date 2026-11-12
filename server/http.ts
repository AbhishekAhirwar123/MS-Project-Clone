import { ObjectId } from 'mongodb';

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);

// Parses an id from the URL; an invalid id is treated like a missing record.
export function oid(id: unknown, what = 'Record'): ObjectId {
  if (typeof id !== 'string' || !ObjectId.isValid(id) || String(new ObjectId(id)) !== id) throw notFound(what + ' not found.');
  return new ObjectId(id);
}

export function str(v: unknown, field: string, { min = 1, max = 200 } = {}): string {
  if (typeof v !== 'string') throw badRequest(field + ' is required.');
  const s = v.trim();
  if (s.length < min) throw badRequest(field + ' is required.');
  if (s.length > max) throw badRequest(field + ' is too long (at most ' + max + ' characters).');
  return s;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function email(v: unknown): string {
  const e = str(v, 'Email', { max: 254 }).toLowerCase();
  if (!EMAIL.test(e)) throw badRequest('Enter a valid email address.');
  return e;
}

// A project plan sent by the planner. Only the outline is checked here; the planner normalises the rest when it loads.
export function projectData(v: unknown): Record<string, unknown> {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || Array.isArray(p) || !Array.isArray(p.tasks) || !Array.isArray(p.resources)) {
    throw badRequest('The plan is missing its tasks or resources.');
  }
  if (p.tasks.length > 20000) throw badRequest('A project can have at most 20,000 tasks.');
  return p;
}

export const planName = (p: Record<string, unknown>) =>
  (typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Untitled project').slice(0, 200);
