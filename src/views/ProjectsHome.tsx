import { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { S, ask, useStore } from '../store';
import { useAuth } from '../auth';
import { goTo, useNav } from '../nav';
import { api, type ProjectSummary, type User } from '../lib/api';
import { initials } from '../components/AccountDialogs';
import { openTemplate, runAction } from '../lib/actions';
import { TEMPLATES } from '../lib/templates';
import { ACCESS_LABELS, ROLES, ROLE_LABELS, canCreateProject, canManage, canManageUsers, type Role } from '../../shared/roles';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Header() {
  const user = useAuth(s => s.user)!;
  const page = useNav(s => s.page);
  const theme = useStore(s => s.theme);
  return (
    <header className="home-head">
      <a className="home-brand" href="#"><img src="./assets/logo.png" alt="" width={22} height={22} />Neo Project</a>
      <nav className="home-tabs">
        <button className={page === 'projects' ? 'on' : ''} onClick={() => goTo('projects')}>Projects</button>
        {canManageUsers(user.role) && <button className={page === 'users' ? 'on' : ''} onClick={() => goTo('users')}>Users</button>}
      </nav>
      <span className="spacer" />
      <button className="qat-btn" title="Dark / light" aria-label="Toggle dark mode" onClick={() => S().setUI({ theme: theme === 'dark' ? 'light' : 'dark' })}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <button className="user-chip" onClick={() => S().openDialog('account')} title="Your account">
        <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
        <span className="hide-sm">{user.name}<small>{ROLE_LABELS[user.role]}</small></span>
      </button>
    </header>
  );
}

/* ---------- projects ---------- */

function ProjectsPage() {
  const user = useAuth(s => s.user)!;
  const [list, setList] = useState<ProjectSummary[] | null>(null), [error, setError] = useState('');
  const creator = canCreateProject(user.role);

  const load = useCallback(() => {
    api<{ projects: ProjectSummary[] }>('GET', '/projects').then(r => { setList(r.projects); setError(''); }, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const replace = (p: ProjectSummary) => setList(l => (l || []).map(x => (x.id === p.id ? p : x)).filter(x => x.access));
  const remove = (p: ProjectSummary) => ask('Delete “' + p.name + '” and all its saved versions for everyone? This cannot be undone.', () => {
    api('DELETE', '/projects/' + p.id).then(() => { S().toast('Project deleted'); setList(l => (l || []).filter(x => x.id !== p.id)); },
      (e: Error) => S().toast('Could not delete: ' + e.message, true));
  }, 'Delete project', 'Delete project');

  return (
    <div className="home-body">
      <div className="home-title">
        <div><h1>Projects</h1><p className="muted">{user.role === 'admin' ? 'Every project in your organisation.' : 'Projects you own or that were shared with you.'}</p></div>
        {creator && <div className="row-actions">
          <button className="btn primary" onClick={() => runAction('new')}><Icon name="plus" />New project</button>
          <button className="btn" onClick={() => runAction('sample')}>Sample project</button>
          <button className="btn" onClick={() => runAction('open')}><Icon name="upload" />Open a file…</button>
          <button className="btn" onClick={() => S().openDialog('import')}><Icon name="table" />Import Excel / CSV…</button>
        </div>}
      </div>

      {error && <p className="alert inline">{error} <button className="btn" onClick={load}>Retry</button></p>}
      {!list && !error && <p className="muted">Loading projects…</p>}
      {list && !list.length && (
        <div className="home-empty">
          <h2>{creator ? 'No projects yet' : 'Nothing shared with you yet'}</h2>
          <p className="muted">{creator ? 'Create a blank project, start from a template below, or open a file.' : 'Ask a project manager to share a project with you. It will appear here.'}</p>
        </div>
      )}
      {list && list.length > 0 && (
        <table className="data home-list">
          <thead><tr><th>Project</th><th>Owner</th><th>Your access</th><th>Shared with</th><th>Last saved</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{list.map(p => (
            <tr key={p.id}>
              <td><button className="link-btn" onClick={() => void S().openProject(p.id)}>{p.name}</button></td>
              <td>{p.owner.name}</td>
              <td><span className={'access-badge ' + p.access}>{ACCESS_LABELS[p.access]}</span></td>
              <td title={p.members.map(m => m.name + ' (' + ACCESS_LABELS[m.access] + ')').join(', ')}>{p.members.length ? p.members.length + (p.members.length > 1 ? ' people' : ' person') : '—'}</td>
              <td>{when(p.updatedAt)}{p.updatedBy && <span className="muted small"> · {p.updatedBy}</span>}</td>
              <td className="ver-acts">
                <button className="btn" onClick={() => void S().openProject(p.id)}>Open</button>
                {canManage(p.access) && <button className="btn" onClick={() => S().openDialog('sharing', { project: p, onSaved: replace })}><Icon name="users" />Share</button>}
                {canManage(p.access) && <button className="icon-btn" title="Delete" aria-label={'Delete ' + p.name} onClick={() => remove(p)}><Icon name="trash" /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}

      {creator && <>
        <h2 className="bs-sub">Start from a template</h2>
        <div className="bs-cards">
          {TEMPLATES.map(t => (
            <button key={t.id} className="bs-card" onClick={() => openTemplate(t)}>
              <div className="bs-thumb sample"><i /><i /><i /></div><b>{t.name}</b><span className="bs-card-sub">{t.desc}</span>
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}

/* ---------- users (admins only) ---------- */

// A random temporary password that meets the password rules; the user replaces it at first sign-in.
function tempPassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const r = crypto.getRandomValues(new Uint32Array(14));
  let s = '';
  r.forEach((n, i) => { s += i % 4 === 3 ? digits[n % digits.length] : chars[n % chars.length]; });
  return s;
}

function UsersPage() {
  const me = useAuth(s => s.user)!;
  const [users, setUsers] = useState<User[] | null>(null), [error, setError] = useState('');
  const [notice, setNotice] = useState<{ name: string; email: string; password: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'team_member' as Role, password: tempPassword() });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ users: User[] }>('GET', '/users').then(r => setUsers(r.users), (e: Error) => setError(e.message));
  }, []);

  const patch = async (u: User, body: Record<string, unknown>, done: string) => {
    try {
      const r = await api<{ user: User }>('PATCH', '/users/' + u.id, body);
      setUsers(list => (list || []).map(x => (x.id === u.id ? r.user : x)));
      S().toast(done);
      return true;
    } catch (e: any) {
      S().toast(e.message, true);
      return false;
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ user: User }>('POST', '/users', form);
      setUsers(list => (list || []).concat([r.user]).sort((a, b) => a.name.localeCompare(b.name)));
      setNotice({ name: r.user.name, email: r.user.email, password: form.password });
      setForm({ name: '', email: '', role: form.role, password: tempPassword() });
    } catch (err: any) {
      S().toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const reset = (u: User) => ask('Reset the password for ' + u.name + '? They will be signed out and must choose a new password at next sign-in.', async () => {
    const password = tempPassword();
    if (await patch(u, { password }, 'Password reset')) setNotice({ name: u.name, email: u.email, password });
  }, 'Reset password');

  const toggle = (u: User) => {
    if (u.active) ask('Deactivate ' + u.name + '? They will be signed out and cannot sign in until reactivated. Their projects are kept.', () => void patch(u, { active: false }, u.name + ' deactivated'), 'Deactivate');
    else void patch(u, { active: true }, u.name + ' reactivated');
  };

  return (
    <div className="home-body">
      <div className="home-title"><div><h1>Users</h1><p className="muted">Create accounts and choose what each person can do.</p></div></div>

      <table className="data role-table">
        <thead><tr><th>Role</th><th>What they can do</th></tr></thead>
        <tbody>
          <tr><td>{ROLE_LABELS.admin}</td><td>Manage users. Full control of every project.</td></tr>
          <tr><td>{ROLE_LABELS.project_manager}</td><td>Create projects. Edit, share and delete the projects they own.</td></tr>
          <tr><td>{ROLE_LABELS.team_member}</td><td>Open projects shared with them; edit those shared with edit access.</td></tr>
          <tr><td>{ROLE_LABELS.viewer}</td><td>Read-only access to projects shared with them.</td></tr>
        </tbody>
      </table>

      <h2 className="bs-sub">Add a user</h2>
      <form className="user-form" onSubmit={create}>
        <label className="field"><span>Name</span><input className="inp" required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field"><span>Email</span><input className="inp" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
        <label className="field"><span>Role</span><select className="sel" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select></label>
        <label className="field"><span>Temporary password</span><input className="inp mono" required minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
        <button className="btn primary" type="submit" disabled={busy}><Icon name="plus" />Add user</button>
      </form>

      {notice && (
        <div className="alert info inline notice">
          <span>Give these sign-in details to <b>{notice.name}</b> privately. They will be asked to choose their own password. <br />
            Email: <code>{notice.email}</code> · Temporary password: <code>{notice.password}</code></span>
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(notice.password).then(() => S().toast('Password copied'), () => {}); }}>Copy password</button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="x" /></button>
        </div>
      )}

      {error && <p className="alert inline">{error}</p>}
      {!users && !error && <p className="muted">Loading users…</p>}
      {users && (
        <table className="data home-list">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{users.map(u => (
            <tr key={u.id} className={u.active ? '' : 'inactive'}>
              <td>{u.name}{u.id === me.id && <span className="muted small"> (you)</span>}</td>
              <td>{u.email}</td>
              <td>
                <select className="sel" aria-label={'Role for ' + u.name} value={u.role}
                  onChange={e => void patch(u, { role: e.target.value }, u.name + ' is now ' + ROLE_LABELS[e.target.value as Role])}>
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </td>
              <td>{u.active ? (u.mustChangePassword ? 'Awaiting first sign-in' : 'Active') : 'Deactivated'}</td>
              <td className="ver-acts">
                <button className="btn" onClick={() => reset(u)}>Reset password</button>
                {u.id !== me.id && <button className="btn" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

export default function ProjectsHome() {
  const page = useNav(s => s.page);
  const user = useAuth(s => s.user)!;
  return (
    <div className="home">
      <Header />
      {page === 'users' && canManageUsers(user.role) ? <UsersPage /> : <ProjectsPage />}
    </div>
  );
}
