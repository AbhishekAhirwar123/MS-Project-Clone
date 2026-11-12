import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import OP from './core';
import type { Project, Schedule, ViewName } from './types';
import { capHistory } from './lib/history';
import { api, ApiError, type ProjectSummary } from './lib/api';
import { canEdit } from '../shared/roles';

// Projects are stored in the database through the API. Only view preferences (zoom, columns, theme)
// and the id of the last project you opened are kept in this browser.
const UISTORE = 'neoproject.ui';
const LAST_PROJECT = 'neoproject.lastProject';

export const DEFAULT_COLS = ['id', 'ind', 'name', 'duration', 'start', 'finish', 'preds', 'res', 'cost'];
export const ZOOMS = ['day', 'week', 'month', 'quarter'] as const;
export const VIEW_NAMES: Record<ViewName, string> = {
  gantt: 'Gantt Chart', board: 'Task Board', network: 'Network Diagram', wbs: 'WBS Chart', resources: 'Resource Sheet',
  org: 'Team Chart', workload: 'Resource Usage', budget: 'Cost & Budget', reports: 'Reports'
};
const VIEW_TABS: Partial<Record<ViewName, string>> = {
  gantt: 'task', board: 'task', resources: 'resource', org: 'resource', workload: 'resource', reports: 'report', budget: 'report'
};

export interface UIState {
  view: ViewName;
  zoom: string;
  critical: boolean;
  gridW: number;
  ganttHide: 'none' | 'table' | 'chart';
  drawer: boolean;
  netScope: string;
  netDates: boolean;
  netZoom: number;
  wbsDepth: number;
  filter: string;
  group: string;
  sort: string;
  cols: string[];
  showBaseline: boolean;
  report: string;
  tab: string;
  timeline: boolean;
  ribbonMin: boolean;
  theme: 'light' | 'dark';
  bars: string;
  fullYear: boolean;
  guide: boolean;
}

// First visit: follow the operating system's light or dark setting, and give the task table about half the window.
const prefersDark = (() => { try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } })();
const defaultGridW = Math.max(460, Math.min(900, Math.round(window.innerWidth * 0.5)));

const UI_DEFAULTS: UIState = {
  view: 'gantt', zoom: 'week', critical: true, gridW: defaultGridW, ganttHide: 'none', drawer: window.innerWidth > 1100, netScope: 'all', netDates: false,
  netZoom: 1, wbsDepth: 99, filter: 'all', group: 'none', sort: 'id', cols: DEFAULT_COLS.slice(), showBaseline: true,
  report: 'overview', tab: 'task', timeline: true, ribbonMin: false, theme: prefersDark ? 'dark' : 'light', bars: 'teal', fullYear: false, guide: true
};
const PERSISTED_UI: (keyof UIState)[] = ['view', 'zoom', 'critical', 'gridW', 'ganttHide', 'drawer', 'netDates', 'wbsDepth', 'filter', 'group', 'sort', 'cols', 'showBaseline', 'report', 'tab', 'timeline', 'theme', 'bars', 'fullYear', 'guide'];

export interface Dialog { type: string; props?: any }
// ok: everything is saved · pending/saving: changes on their way · error: the last save failed and will be retried
// conflict: someone else saved first · readonly: view-only access, nothing to save
export type SaveState = 'ok' | 'pending' | 'saving' | 'error' | 'conflict' | 'readonly';

export interface Store extends UIState {
  p: Project;
  s: Schedule;
  undo: string[];
  redo: string[];
  saveState: SaveState;
  saveError: string;
  // The open project's record on the server (null on the projects page), and the version this editor last saved or loaded.
  project: ProjectSummary | null;
  serverVersion: number;
  sel: number[];
  anchor: number | null;
  collapsed: Record<string, boolean>;
  backstage: boolean;
  bsPage: string;
  menu: string | null;
  dialog: Dialog | null;
  toastMsg: { text: string; err: boolean; id: number } | null;
  pendingFocus: string | null;

  setUI: (patch: Partial<Store>) => void;
  setView: (view: ViewName) => void;
  commit: (fn: (p: Project) => void | false) => boolean;
  undoAct: () => void;
  redoAct: () => void;
  replaceProject: (p: Project, msg?: string) => void;
  select: (uids: number[], anchor?: number | null) => void;
  toast: (text: string, err?: boolean) => void;
  openDialog: (type: string, props?: any) => void;
  closeDialog: () => void;

  openProject: (id: string, quiet?: boolean) => Promise<boolean>;
  showProject: (project: ProjectSummary, data: Project) => void;
  closeProject: () => Promise<void>;
  saveNow: () => Promise<boolean>;
  resolveConflict: (keep: 'mine' | 'theirs') => Promise<void>;
}

function loadUI(): Partial<UIState> {
  try {
    const ui = JSON.parse(localStorage.getItem(UISTORE) || '{}');
    const out: any = {};
    // Keep only values of the expected type, so stale or edited settings cannot break rendering.
    PERSISTED_UI.forEach(k => {
      const v = ui[k], def = UI_DEFAULTS[k];
      if (v == null) return;
      if (Array.isArray(def) ? Array.isArray(v) && v.every((x: unknown) => typeof x === 'string') : typeof v === typeof def) out[k] = v;
    });
    if (out.view && !(out.view in VIEW_NAMES)) delete out.view;
    if (out.theme && out.theme !== 'light' && out.theme !== 'dark') delete out.theme;
    if (out.zoom && !(ZOOMS as readonly string[]).includes(out.zoom)) delete out.zoom;
    if (out.ganttHide && !['none', 'table', 'chart'].includes(out.ganttHide)) delete out.ganttHide;
    if (out.gridW != null && !(out.gridW >= 160 && out.gridW <= 2400)) delete out.gridW;
    return out;
  } catch {
    return {};
  }
}

function saveUI(st: Store) {
  try {
    const ui: any = {};
    PERSISTED_UI.forEach(k => { ui[k] = st[k]; });
    localStorage.setItem(UISTORE, JSON.stringify(ui));
  } catch { /* storage unavailable */ }
}

/* ---------- saving to the server ---------- */

// Changes are sent shortly after you stop editing. One save runs at a time; edits made meanwhile go in the next one.
// Each save says which version it started from, so the server can refuse it if someone else saved in between.
let pending: string | null = null, timer = 0, retryTimer = 0;
let saving: Promise<boolean> | null = null;

function persist(json: string) {
  if (!S().project) return;
  pending = json;
  if (!saving && S().saveState !== 'conflict') useStore.setState({ saveState: 'pending' });
  clearTimeout(timer);
  timer = window.setTimeout(() => { void flush(); }, 800);
}

// Sends any unsaved changes. Resolves true when everything is saved.
function flush(): Promise<boolean> {
  clearTimeout(timer);
  clearTimeout(retryTimer);
  if (saving) return saving.then(() => (pending == null ? S().saveState === 'ok' : flush()));
  const st = S();
  if (pending == null) return Promise.resolve(st.saveState === 'ok' || st.saveState === 'readonly');
  if (!st.project || st.saveState === 'conflict') return Promise.resolve(false);
  const body = pending, id = st.project.id;
  pending = null;
  useStore.setState({ saveState: 'saving' });
  saving = api<{ version: number }>('PUT', '/projects/' + id, { data: JSON.parse(body), baseVersion: st.serverVersion }).then(r => {
    if (S().project?.id === id) useStore.setState({ serverVersion: r.version, saveState: pending == null ? 'ok' : 'pending', saveError: '' });
    return true;
  }, (e: ApiError) => {
    if (S().project?.id !== id) return false;
    if (pending == null) pending = body;
    if (e.status === 409) { useStore.setState({ saveState: 'conflict', saveError: e.message }); return false; }
    useStore.setState({ saveState: 'error', saveError: e.message });
    // Network and server errors are retried; refusals (no access, too large) are not.
    if (e.status === 0 || e.status >= 500) retryTimer = window.setTimeout(() => { void flush(); }, 10000);
    return false;
  }).finally(() => { saving = null; });
  return saving.then(ok => (ok && pending != null ? flush() : ok));
}

function editable(): boolean {
  const st = S();
  if (!st.project || canEdit(st.project.access)) return true;
  st.toast('You have view-only access to this project.', true);
  return false;
}

function rememberProject(id: string | null) {
  try { if (id) localStorage.setItem(LAST_PROJECT, id); else localStorage.removeItem(LAST_PROJECT); } catch { /* storage unavailable */ }
}
export function lastProjectId(): string | null {
  try { return localStorage.getItem(LAST_PROJECT); } catch { return null; }
}

const empty = (): Project => OP.model.normalize(OP.model.blank());
const initial = empty();
let toastId = 0;

export const useStore = create<Store>((set, get) => ({
  ...UI_DEFAULTS,
  ...loadUI(),
  p: initial,
  s: OP.schedule(initial),
  undo: [],
  redo: [],
  saveState: 'ok',
  saveError: '',
  project: null,
  serverVersion: 0,
  sel: [],
  anchor: null,
  collapsed: {},
  backstage: false,
  bsPage: 'info',
  menu: null,
  dialog: null,
  toastMsg: null,
  pendingFocus: null,

  setUI: patch => {
    // Dates are formatted by the engine, so rebuild the schedule to redraw every chart and table.
    if ('fullYear' in patch) { OP.util.setFullYear(patch.fullYear); patch = { ...patch, s: OP.schedule(get().p) }; }
    set(patch);
    if (Object.keys(patch).some(k => (PERSISTED_UI as string[]).includes(k))) saveUI(get());
  },

  setView: view => {
    const tab = VIEW_TABS[view] || get().tab;
    get().setUI({ view, tab, netZoom: 1, backstage: false, menu: null });
  },

  // Every change to the project goes through commit() so it can be undone, saved, and refused on view-only projects.
  commit: fn => {
    if (!editable()) return false;
    const before = JSON.stringify(get().p);
    const next: Project = JSON.parse(before);
    if (fn(next) === false) return false;
    const after = JSON.stringify(next);
    if (after === before) return false;
    const undo = capHistory(get().undo.concat([before]));
    set({ p: next, s: OP.schedule(next), undo, redo: [] });
    persist(after);
    return true;
  },

  undoAct: () => {
    const { undo, redo, p } = get();
    if (!undo.length || !editable()) return;
    const text = undo[undo.length - 1], prev = JSON.parse(text);
    set({ p: prev, s: OP.schedule(prev), undo: undo.slice(0, -1), redo: capHistory(redo.concat([JSON.stringify(p)])) });
    persist(text);
  },

  redoAct: () => {
    const { undo, redo, p } = get();
    if (!redo.length || !editable()) return;
    const text = redo[redo.length - 1], next = JSON.parse(text);
    set({ p: next, s: OP.schedule(next), redo: redo.slice(0, -1), undo: capHistory(undo.concat([JSON.stringify(p)])) });
    persist(text);
  },

  // Replaces the open project's plan (e.g. restoring a version). Undo brings the previous plan back.
  replaceProject: (p, msg) => {
    if (!editable()) return;
    OP.model.normalize(p);
    const old = JSON.stringify(get().p);
    set({ p, s: OP.schedule(p), undo: capHistory(get().undo.concat([old])), redo: [], sel: [], collapsed: {} });
    persist(JSON.stringify(p));
    if (msg) get().toast(msg);
  },

  select: (uids, anchor = null) => set({ sel: uids, anchor: anchor ?? (uids[0] ?? null) }),

  toast: (text, err = false) => set({ toastMsg: { text, err, id: ++toastId } }),
  openDialog: (type, props) => set({ dialog: { type, props }, menu: null }),
  closeDialog: () => set({ dialog: null }),

  openProject: async (id, quiet = false) => {
    try {
      const r = await api<{ project: ProjectSummary; data: Project }>('GET', '/projects/' + encodeURIComponent(id));
      get().showProject(r.project, r.data);
      return true;
    } catch (e: any) {
      rememberProject(null);
      if (!quiet && !(e instanceof ApiError && e.status === 401)) get().toast('Could not open the project: ' + e.message, true);
      return false;
    }
  },

  showProject: (project, data) => {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    pending = null;
    const p = OP.io.fromJSON(JSON.stringify(data));
    set({
      p, s: OP.schedule(p), project, serverVersion: project.version, undo: [], redo: [], sel: [], anchor: null, collapsed: {},
      saveState: canEdit(project.access) ? 'ok' : 'readonly', saveError: '', backstage: false, menu: null
    });
    rememberProject(project.id);
  },

  closeProject: async () => {
    const close = () => {
      clearTimeout(timer);
      clearTimeout(retryTimer);
      pending = null;
      const p = empty();
      set({ project: null, p, s: OP.schedule(p), undo: [], redo: [], sel: [], collapsed: {}, saveState: 'ok', saveError: '', backstage: false, menu: null });
      rememberProject(null);
    };
    if (await flush()) { close(); return; }
    const st = get();
    if (pending == null || st.saveState === 'readonly') { close(); return; }
    ask('Your latest changes could not be saved (' + (st.saveError || 'unknown error') + '). Leave the project and lose them?', close, 'Leave without saving', 'Unsaved changes');
  },

  saveNow: async () => {
    if (get().saveState === 'readonly') { get().toast('You have view-only access, so there is nothing to save.'); return false; }
    const ok = await flush();
    if (ok) get().toast('All changes saved');
    else if (get().saveState === 'conflict') get().toast(get().saveError + ' Choose which copy to keep in the status bar.', true);
    else get().toast('Could not save: ' + (get().saveError || 'unknown error'), true);
    return ok;
  },

  // After a conflict: "theirs" reloads the saved project (your unsaved changes are dropped);
  // "mine" saves your copy over theirs.
  resolveConflict: async keep => {
    const project = get().project;
    if (!project) return;
    if (keep === 'theirs') {
      pending = null;
      if (await get().openProject(project.id)) get().toast('Loaded the latest saved version');
      return;
    }
    try {
      const r = await api<{ project: ProjectSummary }>('GET', '/projects/' + project.id);
      pending = JSON.stringify(get().p);
      set({ serverVersion: r.project.version, saveState: 'pending', saveError: '' });
      await get().saveNow();
    } catch (e: any) {
      get().toast('Could not save: ' + e.message, true);
    }
  }
}));
OP.util.setFullYear(useStore.getState().fullYear);

// Non-reactive access for event handlers and helpers.
export const S = () => useStore.getState();

// Store access for views: re-renders on project and view changes, but not on toasts, menus or dialogs.
export function useApp(): Store {
  return useStore(useShallow((s: Store) => {
    const { toastMsg, menu, dialog, pendingFocus, ...rest } = s;
    return rest;
  })) as Store;
}

// Warn before closing the tab with unsaved changes, and try to send them as the page goes away.
window.addEventListener('beforeunload', e => { if (pending != null || saving) e.preventDefault(); });
window.addEventListener('pagehide', () => {
  const st = S();
  if (pending == null || saving || !st.project || st.saveState === 'conflict') return;
  api('PUT', '/projects/' + st.project.id, { data: JSON.parse(pending), baseVersion: st.serverVersion }, { keepalive: true }).catch(() => { /* best effort */ });
});


export function taskByUid(uid: number) { return S().p.tasks.find(t => t.uid === uid) || null; }
export function resByUid(uid: number) { return S().p.resources.find(r => r.uid === uid) || null; }
export function rowByUid(uid: number) { return S().s.rows.find((r: any) => r.task.uid === uid) || null; }

// Focus an element by its data-fk key once React has rendered.
export function focusKey(fk: string, select = true) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>('[data-fk="' + fk + '"]');
    if (!el) return;
    el.focus();
    if (select && el.select) try { el.select(); } catch { /* not selectable */ }
  });
}

export function ask(message: string, onOk: () => void, okLabel = 'OK', title = 'Please confirm') {
  S().openDialog('confirm', { message, onOk, okLabel, title });
}

OP.notify = (text: string) => S().toast(text, true);
