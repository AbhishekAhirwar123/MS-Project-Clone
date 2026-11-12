import { Router } from 'express';
import { ObjectId, MongoServerError } from 'mongodb';
import { col, type UserDoc } from '../db.js';
import { badRequest, email, HttpError, notFound, oid, str } from '../http.js';
import { hashPassword, passwordProblem } from '../passwords.js';
import { endAllSessions, publicUser, requireRole, requireUser, userOf } from '../auth.js';
import { isRole } from '../../shared/roles.js';

const router = Router();
router.use(requireUser);

// Names and roles of active users, so project managers can pick people to share a project with.
router.get('/directory', requireRole('admin', 'project_manager'), async (_req, res) => {
  const users = await (await col.users()).find({ active: true }).sort({ name: 1 }).toArray();
  res.json({ users: users.map(u => ({ id: String(u._id), name: u.name, email: u.email, role: u.role })) });
});

/* ---------- everything below is for admins only ---------- */

router.use(requireRole('admin'));

router.get('/', async (_req, res) => {
  const users = await (await col.users()).find().sort({ name: 1 }).toArray();
  res.json({ users: users.map(publicUser) });
});

router.post('/', async (req, res) => {
  const name = str(req.body?.name, 'Name', { max: 100 });
  const addr = email(req.body?.email);
  const role = req.body?.role;
  if (!isRole(role)) throw badRequest('Choose a role.');
  const problem = passwordProblem(req.body?.password);
  if (problem) throw badRequest(problem);
  const now = new Date();
  const doc: UserDoc = {
    _id: new ObjectId(), name, email: addr, role, passwordHash: await hashPassword(req.body.password),
    active: true, mustChangePassword: true, createdAt: now, updatedAt: now
  };
  try {
    await (await col.users()).insertOne(doc);
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) throw new HttpError(409, 'A user with this email already exists.');
    throw e;
  }
  res.status(201).json({ user: publicUser(doc) });
});

// Refuses changes that would leave nobody able to manage users.
async function assertAnotherAdmin(exceptId: ObjectId) {
  const others = await (await col.users()).countDocuments({ role: 'admin', active: true, _id: { $ne: exceptId } });
  if (!others) throw badRequest('There must always be at least one active admin.');
}

router.patch('/:id', async (req, res) => {
  const me = userOf(req);
  const id = oid(req.params.id, 'User');
  const users = await col.users();
  const user = await users.findOne({ _id: id });
  if (!user) throw notFound('User not found.');
  const set: Partial<UserDoc> = { updatedAt: new Date() };
  let signOut = false;

  if (req.body?.name !== undefined) set.name = str(req.body.name, 'Name', { max: 100 });
  if (req.body?.email !== undefined) set.email = email(req.body.email);
  if (req.body?.role !== undefined) {
    if (!isRole(req.body.role)) throw badRequest('Choose a role.');
    if (user.role === 'admin' && req.body.role !== 'admin') await assertAnotherAdmin(id);
    set.role = req.body.role;
  }
  if (req.body?.active !== undefined) {
    if (typeof req.body.active !== 'boolean') throw badRequest('Active must be true or false.');
    if (!req.body.active) {
      if (id.equals(me._id)) throw badRequest('You cannot deactivate your own account.');
      if (user.role === 'admin') await assertAnotherAdmin(id);
      signOut = true;
    }
    set.active = req.body.active;
  }
  if (req.body?.password !== undefined) {
    // An admin-set password is temporary: the user must choose their own at next sign-in.
    const problem = passwordProblem(req.body.password);
    if (problem) throw badRequest(problem);
    set.passwordHash = await hashPassword(req.body.password);
    set.mustChangePassword = true;
    signOut = true;
  }

  try {
    await users.updateOne({ _id: id }, { $set: set });
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) throw new HttpError(409, 'A user with this email already exists.');
    throw e;
  }
  if (signOut) await endAllSessions(id);
  res.json({ user: publicUser({ ...user, ...set }) });
});

export default router;
