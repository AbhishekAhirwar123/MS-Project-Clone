import { useEffect, useState, type JSX } from 'react';
import OP from '../core';
import { useApp, ask, VIEW_NAMES, ZOOMS } from '../store';
import { hasImage, loadProject, openTemplate, runAction, userCanCreate } from '../lib/actions';
import { TEMPLATES } from '../lib/templates';
import { deleteVersion, getVersion, listVersions, saveVersion } from '../lib/versions';
import type { VersionInfo } from '../lib/api';
import { useAuth } from '../auth';
import { initials } from './AccountDialogs';
import { ACCESS_LABELS, ROLE_LABELS, canEdit, canManage } from '../../shared/roles';
import Icon from './Icon';
import type { ViewName } from '../types';

const U = OP.util;
const LOGO_MARK = './assets/logo.png';

/* ---------- title bar ---------- */

export function TitleBar() {
  const st = useApp();
  const user = useAuth(s => s.user);
  const [renaming, setRenaming] = useState(false);
  const access = st.project?.access ?? null, readOnly = !canEdit(access);
  useEffect(() => { document.title = st.p.name + ' - Neo Project'; }, [st.p.name]);
  const rename = (value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (name && name !== st.p.name) st.commit(pp => { pp.name = name; });
  };
  return (
    <header className="titlebar">
      <div className="qat">
        <button className="qat-btn home" title="All projects" aria-label="All projects" onClick={() => runAction('projects')}><img className="app-icon" src={LOGO_MARK} alt="" /></button>
        <button className="qat-btn" title="Save now (Ctrl+S)" aria-label="Save now" disabled={readOnly} onClick={() => runAction('save')}><Icon name="save" /></button>
        <button className="qat-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={readOnly || !st.undo.length} onClick={st.undoAct}><Icon name="undo" /></button>
        <button className="qat-btn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={readOnly || !st.redo.length} onClick={st.redoAct}><Icon name="redo" /></button>
      </div>
      <div className="title">
        {renaming
          ? <input className="title-inp" aria-label="Project name" defaultValue={st.p.name} size={st.p.name.length || 8} autoFocus onFocus={e => e.target.select()}
              onBlur={e => rename(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.value = st.p.name; if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} />
          : <button className="title-btn" title={readOnly ? st.p.name : 'Rename project'} disabled={readOnly} onClick={() => setRenaming(true)}>{st.p.name}</button>}
        {' - Neo Project'}
        {readOnly && <span className="ro-badge" title="You can look but not change this project">Read-only</span>}
      </div>
      <div className="tb-right">
        <button className="qat-btn" title="Dark / light" aria-label="Toggle dark mode" onClick={() => st.setUI({ theme: st.theme === 'dark' ? 'light' : 'dark' })}>
          <Icon name={st.theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        {st.project && canManage(access) && (
          <button className="qat-btn" title="Share with people" aria-label="Share with people" onClick={() => st.openDialog('sharing', { project: st.project })}><Icon name="users" /></button>
        )}
        <button className="qat-btn" title="Share a copy as a link" aria-label="Share a copy as a link" onClick={() => runAction('share')}><Icon name="link" /></button>
        <button className="qat-btn" title="About Neo Project" aria-label="About" onClick={() => st.openDialog('about')}><Icon name="info" /></button>
        {user && (
          <button className="user-chip compact" title={user.name + ' · ' + ROLE_LABELS[user.role]} aria-label="Your account" onClick={() => st.openDialog('account')}>
            <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
          </button>
        )}
      </div>
    </header>
  );
}

/* ---------- status bar ---------- */

function SaveStatus() {
  const st = useApp();
  const warn = { color: 'var(--warn)' };
  let body: JSX.Element;
  switch (st.saveState) {
    case 'ok': body = <><Icon name="check" />All changes saved</>; break;
    case 'pending': case 'saving': body = <>Saving…</>; break;
    case 'readonly': body = <>Read-only · {ACCESS_LABELS[st.project?.access || 'view']}</>; break;
    case 'error': body = <span style={warn} title={st.saveError}><Icon name="alert" />Not saved: {st.saveError} <button className="sb-link" onClick={() => void st.saveNow()}>Retry</button></span>; break;
    case 'conflict': body = (
      <span style={warn} title={st.saveError}><Icon name="alert" />{st.saveError}
        <button className="sb-link" onClick={() => ask('Load the latest saved version? Your changes since it was saved will be lost.', () => void st.resolveConflict('theirs'), 'Load theirs')}>Load theirs</button>
        <button className="sb-link" onClick={() => ask('Save your copy over the other person\'s changes? Their changes since you opened the project will be replaced.', () => void st.resolveConflict('mine'), 'Keep mine')}>Keep mine</button>
      </span>
    ); break;
  }
  return <span className="save-state">{body}</span>;
}

const SB_VIEWS: [ViewName, string][] = [['gantt', 'gantt'], ['board', 'columns'], ['resources', 'users'], ['network', 'network'], ['reports', 'report']];

export function StatusBar() {
  const st = useApp();
  const zi = ZOOMS.indexOf(st.zoom as any);
  const setZoom = (i: number) => st.setUI({ zoom: ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i))] });
  return (
    <footer className="statusbar">
      <span>Ready</span>
      <span className="sb-sep" />
      <span className="hide-sm">New Tasks : Auto Scheduled</span>
      <span className="sb-sep hide-sm" />
      <SaveStatus />
      <span className="spacer" />
      <div className="sb-views">
        {SB_VIEWS.map(([v, icon]) => (
          <button key={v} className={st.view === v ? 'active' : ''} title={VIEW_NAMES[v]} aria-label={VIEW_NAMES[v]} onClick={() => st.setView(v)}><Icon name={icon} /></button>
        ))}
      </div>
      <div className="sb-zoom" title="Timescale zoom">
        <button className="z-btn" aria-label="Zoom out" onClick={() => setZoom(zi - 1)}>−</button>
        <input type="range" min={0} max={3} step={1} value={zi} aria-label="Timescale zoom" onChange={e => setZoom(+e.target.value)} />
        <button className="z-btn" aria-label="Zoom in" onClick={() => setZoom(zi + 1)}>+</button>
      </div>
    </footer>
  );
}

/* ---------- File backstage ---------- */

const PAGES: [string, string][] = [['info', 'Info'], ['new', 'New'], ['open', 'Open'], ['save', 'Save'], ['versions', 'Versions'], ['export', 'Export'], ['print', 'Print'], ['about', 'About']];

function Tile({ icon, title, sub, act, disabled }: { icon: string; title: string; sub: string; act: string; disabled?: boolean }) {
  return (
    <button className="bs-tile" disabled={disabled} onClick={() => runAction(act)}>
      <Icon name={icon} /><div><b>{title}</b><span>{sub}</span></div>
    </button>
  );
}

function VersionsPage() {
  const st = useApp();
  const id = st.project!.id, editable = canEdit(st.project!.access);
  const [list, setList] = useState<VersionInfo[] | null>(null), [name, setName] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    listVersions(id).then(setList, (e: Error) => { setList([]); st.toast('Could not load versions: ' + e.message, true); });
  }, [id]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const v = await saveVersion(id, name || 'Version ' + ((list?.length || 0) + 1), st.p);
      st.toast('Version saved');
      setName('');
      setList([v, ...(list || [])]);
    } catch (err: any) {
      st.toast('Could not save the version: ' + err.message, true);
    } finally {
      setBusy(false);
    }
  };
  const restore = (v: VersionInfo) => ask('Restore “' + v.name + '”? It replaces the current plan for everyone; Undo brings the current plan back.', async () => {
    try { loadProject(OP.io.fromJSON(JSON.stringify(await getVersion(id, v.id))), 'Version “' + v.name + '” restored'); } catch (e: any) { st.toast('Could not restore: ' + e.message, true); }
  }, 'Restore');
  const remove = (v: VersionInfo) => ask('Delete the version “' + v.name + '”?', async () => {
    try { await deleteVersion(id, v.id); setList(l => (l || []).filter(x => x.id !== v.id)); } catch (e: any) { st.toast('Could not delete: ' + e.message, true); }
  }, 'Delete');
  return <>
    <h1>Versions</h1>
    <p className="bs-note">Named copies of this plan, for example before a big change. Everyone with access to the project can see them; people who can edit can save and restore them.</p>
    {editable && (
      <form className="ver-form" onSubmit={save}>
        <input className="inp" id="version-name" value={name} onChange={e => setName(e.target.value)} placeholder="Version name, e.g. Before sprint 2" aria-label="Version name" maxLength={80} />
        <button className="btn primary" type="submit" disabled={busy}><Icon name="save" />Save version</button>
      </form>
    )}
    {!list ? <p className="muted">Loading versions…</p> : list.length ? (
      <table className="data ver-list">
        <thead><tr><th>Version</th><th>Saved by</th><th>Saved</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{list.map(v => (
          <tr key={v.id}>
            <td>{v.name}</td><td>{v.createdBy}</td><td>{new Date(v.createdAt).toLocaleString()}</td>
            <td className="ver-acts">
              {editable && <button className="btn" onClick={() => restore(v)}>Restore</button>}
              {editable && <button className="icon-btn" title="Delete" aria-label={'Delete ' + v.name} onClick={() => remove(v)}><Icon name="trash" /></button>}
            </td>
          </tr>
        ))}</tbody>
      </table>
    ) : <p className="muted">No versions saved yet.</p>}
  </>;
}

export function Backstage() {
  const st = useApp();
  useEffect(() => {
    if (!st.backstage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') st.setUI({ backstage: false }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st.backstage]);
  if (!st.backstage) return null;
  const p = st.p, s = st.s, page = st.bsPage, img = hasImage(st), viewName = VIEW_NAMES[st.view];
  let body: JSX.Element;
  if (page === 'new') {
    body = !userCanCreate() ? <><h1>New</h1><p className="bs-note">Only admins and project managers can create projects. Ask one to create a project and share it with you.</p></> : <><h1>New</h1>
      <p className="bs-note">Each of these creates a new project of yours; the open project is not changed.</p><div className="bs-cards">
      <button className="bs-card" onClick={() => runAction('new')}><div className="bs-thumb blank" /><b>Blank Project</b></button>
      <button className="bs-card" onClick={() => runAction('sample')}><div className="bs-thumb sample"><i /><i /><i /></div><b>Sample Project</b></button>
    </div><h2 className="bs-sub">Templates</h2><div className="bs-cards">
      {TEMPLATES.map(t => (
        <button key={t.id} className="bs-card" onClick={() => openTemplate(t)}>
          <div className="bs-thumb sample"><i /><i /><i /></div><b>{t.name}</b><span className="bs-card-sub">{t.desc}</span>
        </button>
      ))}
    </div></>;
  } else if (page === 'open') {
    const create = userCanCreate(), edit = canEdit(st.project?.access ?? null);
    body = <><h1>Open</h1>
      <Tile icon="gantt" title="All projects" sub="Go back to the list of projects you can open" act="projects" />
      <Tile icon="upload" title="Open a file as a new project…" sub="Neo Project files (.neoproject, .json) or Microsoft Project XML (.xml)" act="open" disabled={!create} />
      <Tile icon="table" title="Import from Excel or CSV…" sub="Paste a task list from a spreadsheet, or choose a CSV file; creates a new project" act="import" disabled={!create} />
      <Tile icon="layers" title="Insert as Subproject…" sub="Add another project file to this project under a new summary task" act="insert" disabled={!edit} />
      {!create && <p className="bs-note">Only admins and project managers can create projects.</p>}
    </>;
  } else if (page === 'save') {
    body = <><h1>Save</h1>
      <Tile icon="save" title="Save now" sub="Changes are saved to the database automatically; this sends any pending ones right away (Ctrl+S)" act="save" disabled={st.saveState === 'readonly'} />
      <Tile icon="save" title="Download a copy…" sub="Save the plan as an .neoproject file on your computer" act="saveas" />
      <Tile icon="link" title="Share a copy as a link" sub="Anyone with the link can save their own copy; the plan travels inside the link" act="share" />
      <p className="bs-note">{st.saveState === 'readonly' ? 'You have view-only access to this project, so changes are not saved.'
        : st.saveState === 'ok' ? 'All changes are saved to the database.'
        : st.saveState === 'conflict' ? 'Someone else saved this project after you opened it. Use the status bar to choose which copy to keep.'
        : st.saveState === 'error' ? 'The last save failed: ' + st.saveError
        : 'Saving…'}</p></>;
  } else if (page === 'versions') {
    body = <VersionsPage />;
  } else if (page === 'export') {
    body = <><h1>Export</h1>
      <Tile icon="gantt" title="Microsoft Project XML (.xml)" sub="Open it in MS Project with File › Open. Tasks, links, calendar and resources carry over" act="mspxml" />
      <Tile icon="table" title="Excel workbook (.xlsx)" sub="Task table with real dates, costs and slack" act="xlsx" />
      <Tile icon="table" title="CSV (.csv)" sub="The same table as plain text, for any spreadsheet" act="csv" />
      <Tile icon="image" title={'Picture of the ' + viewName + ' (.png)'} sub={img ? 'For Word reports' : 'Switch to Gantt, Network, WBS or Team Chart first'} act="png" disabled={!img} />
      <Tile icon="image" title="Vector picture (.svg)" sub="Sharp at any size" act="svg" disabled={!img} /></>;
  } else if (page === 'print') {
    body = <><h1>Print</h1><Tile icon="printer" title={'Print ' + viewName} sub="Use “Save as PDF” in the print dialog to create a PDF" act="print" /></>;
  } else if (page === 'about') {
    body = <><h1>About</h1><img className="logo" src="./assets/logo.png" alt="Neo Project" height={48} />
      <p className="bs-note">Free, browser-based project planning: Gantt chart, critical path, network diagram, WBS, resources, leveling, baselines, tracking, earned value and reports.</p>
      <Tile icon="info" title="Keyboard shortcuts and help" sub="Editing tips for the task table and Gantt chart" act="about" />
      <button className="bs-tile" onClick={() => st.setUI({ guide: true, backstage: false })}><Icon name="check" /><div><b>Getting started guide</b><span>Show the four-step checklist again</span></div></button></>;
  } else {
    const props: [string, string][] = [
      ['Start', U.fmtLong(s.startDn)], ['Finish', U.fmtLong(s.finishDn)], ['Duration', U.num(s.duration) + ' days'],
      ['Cost', U.money(s.totalCost, p.currency)], ['Budget', p.budget ? U.money(p.budget, p.currency) : '—'], ['Work', U.num(s.totalWork) + ' hrs'],
      ['Tasks', String(p.tasks.length)], ['Resources', String(p.resources.length)], ['Status', p.status], ['Manager', p.manager || '—'], ['Organisation', p.organization || '—']
    ];
    body = <><h1>Info</h1><div className="bs-cols">
      <div><h2>{p.name}</h2>
        <Tile icon="info" title="Project Information" sub="Name, start date, status date, budget, calendar and custom fields" act="settings" />
        <button className="bs-tile" onClick={() => st.setUI({ backstage: false, tab: 'project' })}>
          <Icon name="layers" /><div><b>{p.baseline ? 'Baseline saved' : 'No baseline'}</b>
            <span>{p.baseline ? 'Saved ' + U.fmtLong(U.parseDate(p.baseline.savedAt.slice(0, 10))) : 'Project › Set Baseline saves the current plan for tracking'}</span></div>
        </button>
      </div>
      <div className="bs-props"><h3>Project Properties</h3>{props.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
    </div></>;
  }
  return (
    <div className="backstage">
      <nav className="bs-nav">
        <button className="bs-back" aria-label="Back" onClick={() => st.setUI({ backstage: false })}><Icon name="up" /></button>
        {PAGES.map(([k, label]) => <button key={k} className={'bs-item' + (page === k ? ' on' : '')} onClick={() => st.setUI({ bsPage: k })}>{label}</button>)}
      </nav>
      <div className="bs-body">{body}</div>
    </div>
  );
}
