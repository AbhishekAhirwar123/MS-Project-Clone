import { Router, type Request } from 'express';
import { ObjectId } from 'mongodb';
import { col, type ProjectDoc, type UserDoc } from '../db.js';
import { badRequest, forbidden, HttpError, notFound, oid, planName, projectData, str } from '../http.js';
import { requireUser, userOf } from '../auth.js';
import {
  canCreateProject, canEdit, canManage, canOwnProject, maxShareAccess, projectAccess, type Access, type ShareAccess
} from '../../shared/roles.js';

const router = Router();
router.use(requireUser);

const MAX_VERSIONS = 50;
const actor = (u: UserDoc) => ({ id: String(u._id), role: u.role });
const accessInfo = (p: Pick<ProjectDoc, 'ownerId' | 'members'>) => ({
  ownerId: String(p.ownerId), members: p.members.map(m => ({ userId: String(m.userId), access: m.access }))
});

// Loads a project and checks the user's access; a project they cannot see looks the same as a missing one.
async function load(req: Request, need: 'view' | 'edit' | 'manage', withData = false): Promise<{ project: ProjectDoc; access: Access }> {
  const user = userOf(req);
  const projects = await col.projects();
  const project = await projects.findOne({ _id: oid(req.params.id, 'Project') }, withData ? {} : { projection: { data: 0 } });
  const access = project && projectAccess(actor(user), accessInfo(project));
  if (!project || !access) throw notFound('Project not found, or it has not been shared with you.');
  if (need === 'edit' && !canEdit(access)) throw forbidden('You have view-only access to this project.');
  if (need === 'manage' && !canManage(access)) throw forbidden('Only the project owner or an admin can do that.');
  return { project, access };
}

async function userNames(ids: ObjectId[]) {
  const users = await (await col.users()).find({ _id: { $in: ids } }, { projection: { name: 1, email: 1, role: 1, active: 1 } }).toArray();
  return new Map(users.map(u => [String(u._id), u]));
}

function summary(p: ProjectDoc, access: Access, names: Map<string, Pick<UserDoc, 'name' | 'email' | 'role' | 'active'>>) {
  return {
    id: String(p._id), name: p.name, access, version: p.version, updatedAt: p.updatedAt, createdAt: p.createdAt,
    owner: { id: String(p.ownerId), name: names.get(String(p.ownerId))?.name || 'Unknown user' },
    updatedBy: names.get(String(p.updatedBy))?.name || '',
    members: p.members.map(m => {
      const u = names.get(String(m.userId));
      return { userId: String(m.userId), access: m.access, name: u?.name || 'Unknown user', email: u?.email || '', role: u?.role, active: !!u?.active };
    })
  };
}

/* ---------- projects ---------- */

router.get('/', async (req, res) => {
  const user = userOf(req);
  const filter = user.role === 'admin' ? {} : { $or: [{ ownerId: user._id }, { 'members.userId': user._id }] };
  const list = await (await col.projects()).find(filter, { projection: { data: 0 } }).sort({ updatedAt: -1 }).toArray();
  const names = await userNames(list.flatMap(p => [p.ownerId, p.updatedBy, ...p.members.map(m => m.userId)]));
  res.json({ projects: list.map(p => summary(p, projectAccess(actor(user), accessInfo(p))!, names)) });
});

router.post('/', async (req, res) => {
  const user = userOf(req);
  if (!canCreateProject(user.role)) throw forbidden('Only admins and project managers can create projects.');
  const data = projectData(req.body?.data);
  const now = new Date();
  const doc: ProjectDoc = {
    _id: new ObjectId(), name: planName(data), ownerId: user._id, members: [], data, version: 1,
    createdAt: now, updatedAt: now, updatedBy: user._id
  };
  await (await col.projects()).insertOne(doc);
  res.status(201).json({ project: summary(doc, 'owner', await userNames([user._id])), data });
});

router.get('/:id', async (req, res) => {
  const { project, access } = await load(req, 'view', true);
  const names = await userNames([project.ownerId, project.updatedBy, ...project.members.map(m => m.userId)]);
  res.json({ project: summary(project, access, names), data: project.data });
});

// Saves the plan. baseVersion is the version the editor started from: if someone else saved in between,
// the save is refused with 409 so neither person's work is silently overwritten.
router.put('/:id', async (req, res) => {
  const user = userOf(req);
  const { project } = await load(req, 'edit');
  const data = projectData(req.body?.data);
  const base = req.body?.baseVersion;
  if (!Number.isInteger(base)) throw badRequest('baseVersion is required.');
  const now = new Date();
  const result = await (await col.projects()).findOneAndUpdate(
    { _id: project._id, version: base },
    { $set: { data, name: planName(data), updatedAt: now, updatedBy: user._id }, $inc: { version: 1 } },
    { returnDocument: 'after', projection: { version: 1 } }
  );
  if (!result) {
    const current = await (await col.projects()).findOne({ _id: project._id }, { projection: { version: 1, updatedBy: 1, updatedAt: 1 } });
    const by = current && (await userNames([current.updatedBy])).get(String(current.updatedBy));
    throw new HttpError(409, 'This project was changed by ' + (by?.name || 'someone else') + ' since you opened it.', {
      version: current?.version, updatedBy: by?.name || '', updatedAt: current?.updatedAt
    });
  }
  res.json({ version: result.version, updatedAt: now });
});

router.delete('/:id', async (req, res) => {
  const { project } = await load(req, 'manage');
  await (await col.projects()).deleteOne({ _id: project._id });
  await (await col.versions()).deleteMany({ projectId: project._id });
  res.json({ ok: true });
});

// Replaces the member list (and, for admins, the owner).
router.put('/:id/sharing', async (req, res) => {
  const user = userOf(req);
  const { project, access } = await load(req, 'manage');
  if (!Array.isArray(req.body?.members)) throw badRequest('members must be a list.');

  let ownerId = project.ownerId;
  if (req.body.ownerId !== undefined && req.body.ownerId !== String(project.ownerId)) {
    if (user.role !== 'admin') throw forbidden('Only an admin can change the owner of a project.');
    ownerId = oid(req.body.ownerId, 'User');
  }

  const wanted = new Map<string, ShareAccess>();
  for (const m of req.body.members) {
    if (!m || typeof m.userId !== 'string' || (m.access !== 'edit' && m.access !== 'view')) throw badRequest('Each member needs a user and an access level.');
    wanted.set(m.userId, m.access);
  }
  wanted.delete(String(ownerId));
  const ids = [...wanted.keys()].map(id => oid(id, 'User'));
  const users = await userNames([ownerId, ...ids]);
  const owner = users.get(String(ownerId));
  if (!owner || !owner.active) throw badRequest('The new owner must be an active user.');
  if (!canOwnProject(owner.role)) throw badRequest('Only an admin or a project manager can own a project.');
  const members = ids.map(id => {
    const u = users.get(String(id));
    if (!u || !u.active) throw badRequest('One of the people you chose no longer has an active account.');
    // Viewers are always read-only, whatever they are shared with.
    const a = wanted.get(String(id))!;
    return { userId: id, access: maxShareAccess(u.role) === 'view' ? 'view' as const : a };
  });

  await (await col.projects()).updateOne({ _id: project._id }, { $set: { ownerId, members } });
  const updated = { ...project, ownerId, members };
  const names = await userNames([ownerId, project.updatedBy, ...ids]);
  // The previous owner may have lost owner access if an admin moved the project.
  res.json({ project: summary(updated, projectAccess(actor(user), accessInfo(updated)) || access, names) });
});

/* ---------- named versions (snapshots) ---------- */

router.get('/:id/versions', async (req, res) => {
  const { project } = await load(req, 'view');
  const list = await (await col.versions()).find({ projectId: project._id }, { projection: { data: 0 } }).sort({ createdAt: -1 }).toArray();
  res.json({ versions: list.map(v => ({ id: String(v._id), name: v.name, createdAt: v.createdAt, createdBy: v.createdByName })) });
});

router.post('/:id/versions', async (req, res) => {
  const user = userOf(req);
  const { project } = await load(req, 'edit');
  const name = str(req.body?.name, 'Version name', { max: 80 });
  const data = projectData(req.body?.data);
  const versions = await col.versions();
  const doc = { _id: new ObjectId(), projectId: project._id, name, data, createdAt: new Date(), createdBy: user._id, createdByName: user.name };
  await versions.insertOne(doc);
  // Keep the newest MAX_VERSIONS.
  const old = await versions.find({ projectId: project._id }, { projection: { _id: 1 } }).sort({ createdAt: -1 }).skip(MAX_VERSIONS).toArray();
  if (old.length) await versions.deleteMany({ _id: { $in: old.map(v => v._id) } });
  res.status(201).json({ version: { id: String(doc._id), name, createdAt: doc.createdAt, createdBy: user.name } });
});

router.get('/:id/versions/:vid', async (req, res) => {
  const { project } = await load(req, 'view');
  const v = await (await col.versions()).findOne({ _id: oid(req.params.vid, 'Version'), projectId: project._id });
  if (!v) throw notFound('Version not found.');
  res.json({ version: { id: String(v._id), name: v.name, createdAt: v.createdAt, createdBy: v.createdByName }, data: v.data });
});

router.delete('/:id/versions/:vid', async (req, res) => {
  const { project } = await load(req, 'edit');
  const r = await (await col.versions()).deleteOne({ _id: oid(req.params.vid, 'Version'), projectId: project._id });
  if (!r.deletedCount) throw notFound('Version not found.');
  res.json({ ok: true });
});

export default router;
