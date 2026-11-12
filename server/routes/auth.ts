import { Router } from 'express';
import { col } from '../db.js';
import { badRequest, email, HttpError } from '../http.js';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from '../passwords.js';
import {
  checkLockout, clearFailedLogins, endAllSessions, endSession, publicUser, recordFailedLogin, requireUser, startSession, userOf
} from '../auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const addr = email(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  await checkLockout(addr);
  const user = await (await col.users()).findOne({ email: addr });
  // Always run a hash check so the response time doesn't reveal whether the account exists.
  const ok = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok || !user.active) {
    await recordFailedLogin(addr);
    throw new HttpError(401, user && ok && !user.active ? 'This account has been deactivated. Contact your administrator.' : 'Incorrect email or password.');
  }
  await clearFailedLogins(addr);
  await startSession(res, user._id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: publicUser(userOf(req)) });
});

router.post('/password', requireUser, async (req, res) => {
  const user = userOf(req);
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  const next = req.body?.next;
  if (!(await verifyPassword(current, user.passwordHash))) throw badRequest('Your current password is incorrect.');
  const problem = passwordProblem(next);
  if (problem) throw badRequest(problem);
  if (next === current) throw badRequest('Choose a password different from the current one.');
  await (await col.users()).updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(next), mustChangePassword: false, updatedAt: new Date() } });
  // Other devices are signed out; this one stays signed in.
  await endAllSessions(user._id, req);
  res.json({ user: publicUser({ ...user, mustChangePassword: false }) });
});

export default router;
