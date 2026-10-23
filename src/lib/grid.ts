import OP from '../core';
import type { Store } from '../store';
import type { Row } from '../types';

const U = OP.util, M = OP.model;

/* ---------- columns ---------- */

export interface Col {
  t: string;
  w: number;
  fixed?: boolean;
  num?: boolean;
  edit?: 'duration' | 'work' | 'preds' | 'number' | 'percent' | 'date' | 'datetext' | 'select' | 'text' | 'cftext' | 'cfnum';
  field?: string;
  // Editable columns whose value is computed rather than stored on the task: what the editor starts from.
  editValue?: (r: Row) => string;
  options?: Record<string, string>;
  sumRo?: boolean;
  cf?: string;
  get?: (r: Row) => string;
}

const dayNum = (v: number) => (v == null || !isFinite(v) ? '' : U.num(v));
const money = (v: number) => (v == null ? '' : U.money(v));
const signedDays = (v: number) => (v == null ? '' : (v > 0 ? '+' : '') + U.num(v) + 'd');

export const COLS: Record<string, Col> = {
  id: { t: 'ID', w: 44, fixed: true },
  ind: { t: '', w: 56, fixed: true },
  name: { t: 'Task Name', w: 250, fixed: true },
  wbs: { t: 'WBS', w: 64, get: r => r.wbs },
  mode: { t: 'Task mode', w: 150, edit: 'select', options: { auto: 'Auto scheduled', manual: 'Manually scheduled' }, editValue: r => (r.manual ? 'manual' : 'auto'), sumRo: true },
  active: { t: 'Active', w: 80, edit: 'select', options: { yes: 'Yes', no: 'No' }, editValue: r => (r.inactive ? 'no' : 'yes') },
  duration: { t: 'Duration', w: 76, edit: 'duration', get: r => M.fmtDuration(r.shown, r.elapsed), sumRo: true },
  work: { t: 'Work', w: 80, edit: 'work', num: true, get: r => U.num(r.work) + 'h', sumRo: true },
  start: { t: 'Start', w: 96, edit: 'datetext', get: r => U.fmt(r.startDn), sumRo: true },
  finish: { t: 'Finish', w: 96, edit: 'datetext', get: r => U.fmt(r.finishDn), sumRo: true },
  preds: { t: 'Predecessors', w: 100, edit: 'preds' },
  res: { t: 'Resources', w: 150 },
  cost: { t: 'Cost', w: 96, num: true, get: r => U.money(r.cost) },
  fixedCost: { t: 'Fixed cost', w: 96, num: true, edit: 'number', field: 'fixedCost', get: r => String(r.task.fixedCost || 0) },
  percent: { t: '% Complete', w: 90, num: true, edit: 'percent', get: r => r.percent + '%', sumRo: true },
  actualStart: { t: 'Actual start', w: 130, edit: 'date', field: 'actualStart', sumRo: true },
  actualFinish: { t: 'Actual finish', w: 130, edit: 'date', field: 'actualFinish', sumRo: true },
  constraint: { t: 'Constraint', w: 170, edit: 'select', field: 'constraint', options: M.CONSTRAINTS, sumRo: true },
  constraintDate: { t: 'Constraint date', w: 130, edit: 'date', field: 'constraintDate', sumRo: true },
  deadline: { t: 'Deadline', w: 130, edit: 'date', field: 'deadline', sumRo: true },
  type: { t: 'Task type', w: 130, edit: 'select', field: 'type', options: M.TASK_TYPES, sumRo: true },
  priority: { t: 'Priority', w: 74, num: true, edit: 'number', field: 'priority', get: r => String(r.task.priority) },
  slack: { t: 'Total slack', w: 86, num: true, get: r => U.num(r.slack) + 'd' },
  freeSlack: { t: 'Free slack', w: 80, num: true, get: r => (r.summary ? '' : U.num(r.freeSlack) + 'd') },
  es: { t: 'ES', w: 56, num: true, get: r => dayNum(r.es) },
  ef: { t: 'EF', w: 56, num: true, get: r => dayNum(r.ef) },
  ls: { t: 'LS', w: 56, num: true, get: r => dayNum(r.ls) },
  lf: { t: 'LF', w: 56, num: true, get: r => dayNum(r.lf) },
  bStart: { t: 'Baseline start', w: 104, get: r => (r.base ? U.fmt(r.base.startDn) : '') },
  bFinish: { t: 'Baseline finish', w: 104, get: r => (r.base ? U.fmt(r.base.finishDn) : '') },
  bCost: { t: 'Baseline cost', w: 110, num: true, get: r => (r.base ? U.money(r.base.cost) : '') },
  startVar: { t: 'Start var.', w: 80, num: true, get: r => (r.base ? signedDays(r.startVar) : '') },
  finishVar: { t: 'Finish var.', w: 80, num: true, get: r => (r.base ? signedDays(r.finishVar) : '') },
  costVar: { t: 'Cost var.', w: 100, num: true, get: r => (r.base ? U.money(r.costVar) : '') },
  actualCost: { t: 'Actual cost', w: 104, num: true, get: r => money(r.actualCost) },
  bcws: { t: 'BCWS (PV)', w: 104, num: true, get: r => money(r.bcws) },
  bcwp: { t: 'BCWP (EV)', w: 104, num: true, get: r => money(r.bcwp) },
  acwp: { t: 'ACWP (AC)', w: 104, num: true, get: r => money(r.acwp) },
  sv: { t: 'SV', w: 96, num: true, get: r => money(r.bcwp - r.bcws) },
  cv: { t: 'CV', w: 96, num: true, get: r => money(r.bcwp - r.acwp) },
  levelDelay: { t: 'Leveling delay', w: 100, num: true, get: r => (r.task.levelDelay ? U.num(r.task.levelDelay) + 'd' : '') },
  notes: { t: 'Notes', w: 200, edit: 'text', field: 'notes' }
};

export const COL_GROUPS: [string, string[]][] = [
  ['General', ['wbs', 'mode', 'active', 'duration', 'work', 'start', 'finish', 'preds', 'res', 'cost', 'fixedCost', 'priority', 'type', 'notes']],
  ['Schedule', ['constraint', 'constraintDate', 'deadline', 'slack', 'freeSlack', 'es', 'ef', 'ls', 'lf', 'levelDelay']],
  ['Tracking', ['percent', 'actualStart', 'actualFinish', 'actualCost', 'bStart', 'bFinish', 'bCost', 'startVar', 'finishVar', 'costVar']],
  ['Earned value', ['bcws', 'bcwp', 'acwp', 'sv', 'cv']]
];
const COL_ORDER = ['id', 'ind', 'name'].concat(COL_GROUPS.flatMap(g => g[1]));

export function colDef(st: Store, k: string): Col | null {
  if (COLS[k]) return COLS[k];
  const m = /^cf:(.+)$/.exec(k);
  const f = m && st.p.customFields.find(x => x.id === m[1]);
  if (!f) return null;
  return { t: f.name, w: 120, num: f.type === 'number', edit: f.type === 'number' ? 'cfnum' : 'cftext', cf: f.id };
}

export function activeCols(st: Store): string[] {
  const ks = st.cols.filter(k => colDef(st, k));
  ['name', 'ind', 'id'].forEach(k => { if (!ks.includes(k)) ks.unshift(k); });
  return ks;
}

export function toggleCol(cols: string[], k: string, on: boolean): string[] {
  const next = cols.filter(c => c !== k);
  if (on) next.push(k);
  return next.sort((a, b) => {
    const x = COL_ORDER.indexOf(a), y = COL_ORDER.indexOf(b);
    return (x < 0 ? 999 : x) - (y < 0 ? 999 : y);
  });
}

/* ---------- filter, group, sort ---------- */

export const FILTERS: Record<string, string> = {
  all: 'All tasks', critical: 'Critical tasks', milestones: 'Milestones', summary: 'Summary tasks',
  incomplete: 'Incomplete tasks', complete: 'Completed tasks', late: 'Behind schedule', slipped: 'Slipped vs baseline',
  overalloc: 'Overallocated resources', deadline: 'Missed deadlines', conflicts: 'Constraint conflicts'
};
export const GROUPS: Record<string, string> = { none: 'No grouping', critical: 'Critical', milestone: 'Milestone', status: 'Progress status', resource: 'Resource', priority: 'Priority', type: 'Task type' };
export const SORTS: Record<string, string> = { id: 'ID', start: 'Start date', finish: 'Finish date', duration: 'Duration', name: 'Name', cost: 'Cost', priority: 'Priority', slack: 'Total slack' };

export function menuData(st: Store) {
  const filters: Record<string, string> = { ...FILTERS };
  st.p.resources.forEach(r => { filters['res:' + r.uid] = 'Using ' + (r.name || '(unnamed)'); });
  const groups: Record<string, string> = { ...GROUPS };
  st.p.customFields.forEach(cf => { groups['cf:' + cf.id] = cf.name; });
  return { filters, groups, sorts: SORTS };
}

function matches(st: Store, r: Row) {
  const f = st.filter, t = r.task;
  if (f === 'all') return true;
  if (f === 'summary') return r.summary;
  if (r.summary) return false;
  if (f === 'critical') return r.critical;
  if (f === 'milestones') return r.milestone;
  if (f === 'incomplete') return r.percent < 100;
  if (f === 'complete') return r.percent >= 100;
  if (f === 'late') return r.late;
  if (f === 'slipped') return !!r.slipped;
  if (f === 'overalloc') return r.over;
  if (f === 'deadline') return r.missedDeadline;
  if (f === 'conflicts') return !!r.conflict;
  const m = /^res:(\d+)$/.exec(f);
  if (m) return t.assignments.some((a: any) => a.res === +m[1]);
  return true;
}

function sortKey(st: Store, r: Row): number | string {
  switch (st.sort) {
    case 'start': return r.startDn;
    case 'finish': return r.finishDn;
    case 'duration': return -r.duration;
    case 'name': return (r.task.name || '').toLowerCase();
    case 'cost': return -r.cost;
    case 'priority': return -r.task.priority;
    case 'slack': return r.slack;
    default: return r.i;
  }
}

function groupKeys(st: Store, r: Row): string[] {
  const g = st.group, t = r.task;
  if (g === 'critical') return [r.critical ? 'Critical' : 'Not critical'];
  if (g === 'milestone') return [r.milestone ? 'Milestones' : 'Tasks'];
  if (g === 'status') return [r.percent >= 100 ? 'Complete' : r.percent > 0 ? 'In progress' : 'Not started'];
  if (g === 'priority') return ['Priority ' + t.priority];
  if (g === 'type') return [M.TASK_TYPES[t.type] || t.type];
  if (g === 'resource') {
    const names = t.assignments.map((a: any) => { const res = st.p.resources.find(x => x.uid === a.res); return res ? res.name || '(unnamed)' : null; }).filter((n): n is string => !!n);
    return names.length ? names : ['Unassigned'];
  }
  const m = /^cf:(.+)$/.exec(g);
  if (m) { const v = t.custom && t.custom[m[1]]; return [v === '' || v == null ? '(blank)' : String(v)]; }
  return ['All'];
}

export interface GroupItem { group: true; key: string; label: string; count: number; cost: number; startDn: number; finishDn: number }

// Rows to display, honouring filter, grouping, sorting and collapsed summaries.
export function gridItems(st: Store): (Row | GroupItem)[] {
  const rows: Row[] = st.s.rows;
  const cmp = (a: Row, b: Row) => {
    const x = sortKey(st, a), y = sortKey(st, b);
    return x < y ? -1 : x > y ? 1 : a.i - b.i;
  };
  if (st.group !== 'none') {
    const groups: Record<string, Row[]> = {}, order: string[] = [];
    rows.forEach(r => {
      if (r.summary || !matches(st, r)) return;
      groupKeys(st, r).forEach(k => {
        if (!groups[k]) { groups[k] = []; order.push(k); }
        groups[k].push(r);
      });
    });
    order.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const out: (Row | GroupItem)[] = [];
    order.forEach(k => {
      const list = groups[k].sort(cmp), key = 'g:' + k;
      out.push({
        group: true, key, label: k, count: list.length,
        cost: list.reduce((a, r) => a + r.cost, 0),
        startDn: Math.min(...list.map(r => r.startDn)),
        finishDn: Math.max(...list.map(r => r.finishDn))
      });
      if (!st.collapsed[key]) out.push(...list);
    });
    return out;
  }
  const keep: Record<number, boolean> = {};
  rows.forEach(r => {
    if (!matches(st, r)) return;
    keep[r.i] = true;
    for (let q = r.parent; q >= 0; q = rows[q].parent) keep[q] = true;
  });
  const res: Row[] = [];
  const walk = (list: Row[]) => {
    list.slice().sort(cmp).forEach(r => {
      if (!keep[r.i]) return;
      res.push(r);
      if (r.summary && !st.collapsed[r.task.uid]) walk(r.children.map((c: number) => rows[c]));
    });
  };
  walk(rows.filter(r => r.parent < 0));
  return res;
}
