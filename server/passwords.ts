import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Passwords are hashed with scrypt (built into Node) and a random salt per password.
// Stored format: scrypt$N$r$p$salt$hash, so the cost can be raised later without breaking old hashes.
const N = 16384, R = 8, P = 1, KEYLEN = 64;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, KEYLEN, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'), { N: +n, r: +r, p: +p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Returns a message when the password is too weak, or null when it is acceptable.
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'Enter a password.';
  if (password.length < 10) return 'Use at least 10 characters for the password.';
  if (password.length > 200) return 'The password is too long.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers in the password.';
  return null;
}

// Used when the email is unknown, so a login takes the same time whether or not the account exists.
export const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');
