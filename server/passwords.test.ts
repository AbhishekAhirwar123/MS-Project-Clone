import { describe, expect, it } from 'vitest';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from './passwords';

describe('passwords', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse 42');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse 42', hash)).toBe(true);
    expect(await verifyPassword('correct horse 43', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password 1')).not.toBe(await hashPassword('same password 1'));
  });

  it('never matches the dummy hash or a malformed one', async () => {
    expect(await verifyPassword('anything 123', DUMMY_HASH)).toBe(false);
    expect(await verifyPassword('anything 123', 'not-a-hash')).toBe(false);
  });

  it('rejects weak passwords', () => {
    expect(passwordProblem('short1')).toMatch(/10 characters/);
    expect(passwordProblem('onlyletterslong')).toMatch(/letters and numbers/);
    expect(passwordProblem('good password 7')).toBeNull();
  });
});
