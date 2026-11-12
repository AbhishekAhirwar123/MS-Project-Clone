import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Dialogs';
import Icon from './Icon';
import { S } from '../store';
import { changePassword, signOut, useAuth } from '../auth';
import { goTo } from '../nav';
import { api, type DirectoryUser, type ProjectSummary } from '../lib/api';
import { ACCESS_LABELS, ROLE_LABELS, canManageUsers, canOwnProject, maxShareAccess, type ShareAccess } from '../../shared/roles';

export async function leaveAndSignOut() {
  if (S().project) {
    await S().closeProject();
    if (S().project) return; // stayed because of unsaved changes
  }
  await signOut();
  S().toast('Signed out');
}

export function AccountDialog() {
  const user = useAuth(s => s.user);
  if (!user) return null;
  const toUsers = async () => {
    S().closeDialog();
    await S().closeProject();
    if (!S().project) goTo('users');
  };
  return (
    <Modal title="Your account" cancelLabel="Close" noOk>
      <div className="acct-head">
        <span className="avatar lg" aria-hidden="true">{initials(user.name)}</span>
        <div><b>{user.name}</b><span className="muted">{user.email}</span><span className="role-badge">{ROLE_LABELS[user.role]}</span></div>
      </div>
      <p className="muted small">{ROLE_HELP[user.role]}</p>
      <div className="acct-actions">
        <button type="button" className="btn" onClick={() => S().openDialog('password')}><Icon name="settings" />Change password</button>
        {canManageUsers(user.role) && <button type="button" className="btn" onClick={toUsers}><Icon name="users" />Manage users</button>}
        <button type="button" className="btn" onClick={() => { S().closeDialog(); void leaveAndSignOut(); }}><Icon name="x" />Sign out</button>
      </div>
    </Modal>
  );
}

const ROLE_HELP = {
  admin: 'You manage user accounts and have full control of every project.',
  project_manager: 'You can create projects, and edit, share and delete the projects you own.',
  team_member: 'You can open projects shared with you, and edit those shared with edit access.',
  viewer: 'You can open projects shared with you, read-only.'
};

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

export function PasswordForm({ onDone, temporary }: { onDone: () => void; temporary?: boolean }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = String(fd.get('next'));
    if (next !== String(fd.get('confirm'))) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await changePassword(String(fd.get('current')), next);
      S().toast('Password changed');
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field"><span>{temporary ? 'Temporary password' : 'Current password'}</span><input className="inp" name="current" type="password" autoComplete="current-password" required autoFocus /></label>
      <label className="field"><span>New password (at least 10 characters, with letters and numbers)</span><input className="inp" name="next" type="password" autoComplete="new-password" minLength={10} required /></label>
      <label className="field"><span>Confirm new password</span><input className="inp" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
      {error && <p className="alert inline" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}

// Not built on Modal, because Modal wraps its content in a form and the password form needs its own.
export function PasswordDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => S().closeDialog();
  useEffect(() => { const d = ref.current!; if (!d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={close} onCancel={e => { e.preventDefault(); close(); }}>
      <div className="dlg-head"><h2>Change password</h2><button type="button" className="icon-btn" aria-label="Close" onClick={close}><Icon name="x" /></button></div>
      <div className="dlg-body">
        <PasswordForm onDone={close} />
        <p className="muted small">Other devices signed in to your account will be signed out.</p>
      </div>
    </dialog>
  );
}

/* ---------- project sharing ---------- */

export function SharingDialog({ project, onSaved }: { project: ProjectSummary; onSaved?: (p: ProjectSummary) => void }) {
  const me = useAuth(s => s.user);
  const [people, setPeople] = useState<DirectoryUser[] | null>(null);
  const [ownerId, setOwnerId] = useState(project.owner.id);
  const [members, setMembers] = useState(project.members.map(m => ({ userId: m.userId, access: m.access })));
  const [pick, setPick] = useState(''), [pickAccess, setPickAccess] = useState<ShareAccess>('edit');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ users: DirectoryUser[] }>('GET', '/users/directory').then(r => setPeople(r.users), (e: Error) => setError(e.message));
  }, []);

  const byId = useMemo(() => new Map((people || []).map(u => [u.id, u])), [people]);
  const known = new Map(project.members.map(m => [m.userId, m]));
  const label = (id: string) => byId.get(id)?.name || known.get(id)?.name || 'Unknown user';
  const roleOf = (id: string) => byId.get(id)?.role || known.get(id)?.role;
  const candidates = (people || []).filter(u => u.id !== ownerId && !members.some(m => m.userId === u.id));
  const owners = (people || []).filter(u => canOwnProject(u.role));
  const isAdmin = me?.role === 'admin';

  const add = () => {
    if (!pick) return;
    const role = byId.get(pick)?.role;
    setMembers(members.concat([{ userId: pick, access: role && maxShareAccess(role) === 'view' ? 'view' : pickAccess }]));
    setPick('');
  };

  return (
    <Modal title={'Share “' + project.name + '”'} okLabel="Save sharing" onSubmit={() => {
      api<{ project: ProjectSummary }>('PUT', '/projects/' + project.id + '/sharing', { ownerId, members: members.filter(m => m.userId !== ownerId) }).then(r => {
        S().toast('Sharing updated');
        if (S().project?.id === project.id) S().setUI({ project: r.project });
        onSaved?.(r.project);
      }, (e: Error) => S().toast('Could not update sharing: ' + e.message, true));
    }}>
      {error && <p className="alert inline">{error}</p>}
      <div className="field"><span>Owner</span>
        {isAdmin && people
          ? <select className="sel" value={ownerId} onChange={e => setOwnerId(e.target.value)} aria-label="Owner">
              {!owners.some(u => u.id === ownerId) && <option value={ownerId}>{project.owner.name}</option>}
              {owners.map(u => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]})</option>)}
            </select>
          : <b>{project.owner.name}</b>}
      </div>
      <div className="field"><span>People with access</span>
        <div className="mini-list">
          {!members.length && <div className="muted small">Only the owner and admins can see this project.</div>}
          {members.map((m, k) => {
            const role = roleOf(m.userId), viewOnly = !!role && maxShareAccess(role) === 'view';
            return (
              <div className="mini-row share" key={m.userId}>
                <span className="share-name">{label(m.userId)}<span className="muted small">{role ? ROLE_LABELS[role] : ''}</span></span>
                <select className="sel" aria-label={'Access for ' + label(m.userId)} value={viewOnly ? 'view' : m.access} disabled={viewOnly}
                  onChange={e => setMembers(members.map((x, i) => (i === k ? { ...x, access: e.target.value as ShareAccess } : x)))}>
                  <option value="edit">{ACCESS_LABELS.edit}</option><option value="view">{ACCESS_LABELS.view}</option>
                </select>
                <button type="button" className="icon-btn" aria-label={'Remove ' + label(m.userId)} onClick={() => setMembers(members.filter((_, i) => i !== k))}><Icon name="x" /></button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="share-add">
        <select className="sel" value={pick} onChange={e => setPick(e.target.value)} aria-label="Person to add" disabled={!people}>
          <option value="">{people ? (candidates.length ? 'Add a person…' : 'Everyone already has access') : 'Loading people…'}</option>
          {candidates.map(u => <option key={u.id} value={u.id}>{u.name} · {u.email} ({ROLE_LABELS[u.role]})</option>)}
        </select>
        <select className="sel" value={pickAccess} onChange={e => setPickAccess(e.target.value as ShareAccess)} aria-label="Access for the new person">
          <option value="edit">{ACCESS_LABELS.edit}</option><option value="view">{ACCESS_LABELS.view}</option>
        </select>
        <button type="button" className="btn" onClick={add} disabled={!pick}><Icon name="plus" />Add</button>
      </div>
      <p className="muted small">Viewers are always read-only. Changes take effect when people next open or save the project.</p>
    </Modal>
  );
}
