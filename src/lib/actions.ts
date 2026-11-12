import OP from '../core';
import { S, VIEW_NAMES, ask, type Store } from '../store';
import { gridItems } from './grid';
import { toXlsx } from './xlsx';
import { fromMspXml, toMspXml } from './mspxml';
import { fromTemplate, type Template } from './templates';
import { api, type ProjectSummary } from './api';
import { currentUser, whenSignedIn } from '../auth';
import { canCreateProject } from '../../shared/roles';
import type { Project } from '../types';

const U = OP.util, C = OP.charts, IO = OP.io;

const W = window as any;
const FS = !!W.showSaveFilePicker;
const TYPES = [{ description: 'Neo Project project', accept: { 'application/x-neoproject': ['.neoproject'] } }];
let handle: any = null;

const MAX_FILE_MB = 20;
function checkSize(file: File) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error('The file is larger than ' + MAX_FILE_MB + ' MB, so it is not an Neo Project project.');
}

async function saveFile(as: boolean) {
  const st = S();
  if (!FS) { U.download(U.slug(st.p.name) + '.neoproject', IO.toJSON(st.p), 'application/x-neoproject'); st.toast('Project file downloaded'); return; }
  try {
    if (as || !handle) handle = await W.showSaveFilePicker({ suggestedName: U.slug(st.p.name) + '.neoproject', types: TYPES });
    const w = await handle.createWritable();
    await w.write(IO.toJSON(st.p));
    await w.close();
    st.toast('Saved to ' + handle.name);
  } catch (e: any) {
    if (e.name !== 'AbortError') st.toast('Could not save: ' + e.message, true);
  }
}

// Neo Project files are JSON; Microsoft Project XML is recognised by its extension or its first characters.
const isMspXml = (name: string, text: string) => /\.xml$/i.test(name) || /^\s*(<\?xml|<Project)/.test(text);

function readProject(name: string, text: string): { project: Project; note: string } {
  if (!isMspXml(name, text)) return { project: IO.fromJSON(text), note: '' };
  const { project, warnings } = fromMspXml(text);
  return { project, note: warnings.length ? '. Note: ' + warnings.join('; ') : '' };
}

async function openHandle(h: any) {
  const file = await h.getFile();
  checkSize(file);
  const { project, note } = readProject(file.name, await file.text());
  await createProject(project, 'Opened ' + file.name + ' as a new project' + note);
}

export const userCanCreate = () => { const u = currentUser(); return !!u && canCreateProject(u.role); };

// Saves a plan as a new project in the database and opens it. Used by New, templates, opening files and imports.
export async function createProject(p: Project, msg: string): Promise<boolean> {
  if (!userCanCreate()) {
    S().toast('Only admins and project managers can create projects. Ask one to create the project and share it with you.', true);
    return false;
  }
  if (S().project) {
    await S().closeProject();
    if (S().project) return false; // the user chose to stay because of unsaved changes
  }
  try {
    handle = null;
    const r = await api<{ project: ProjectSummary; data: Project }>('POST', '/projects', { data: OP.model.normalize(p) });
    S().showProject(r.project, r.data);
    if (location.hash !== '#app') location.hash = 'app';
    S().toast(msg);
    return true;
  } catch (e: any) {
    S().toast('Could not create the project: ' + e.message, true);
    return false;
  }
}

// Opens a plan someone shared as a link: it becomes a new project of yours, after asking.
export function openSharedCopy(p: Project) {
  whenSignedIn(() => ask('Save a copy of the shared plan “' + p.name + '” as a new project?', () => { void createProject(p, 'Shared plan saved as a new project'); }, 'Save copy'));
}

async function openFile() {
  try {
    const [h] = await W.showOpenFilePicker({ types: [{ description: 'Project files', accept: { 'application/x-neoproject': ['.neoproject'], 'application/json': ['.json'], 'application/xml': ['.xml'] } }] });
    await openHandle(h);
  } catch (e: any) {
    if (e.name !== 'AbortError') S().toast('Could not open file: ' + e.message, true);
  }
}

export function handleLaunchFiles() {
  W.launchQueue?.setConsumer((params: any) => {
    if (!params.files?.length) return;
    location.hash = 'app';
    whenSignedIn(() => { openHandle(params.files[0]).catch((e: any) => S().toast('Could not open file: ' + e.message, true)); });
  });
}

export function scopeRows(st: Store) {
  if (st.netScope === 'all') return st.s.rows;
  const r = st.s.rows.find((x: any) => String(x.task.uid) === String(st.netScope));
  return r ? r.leaves.map((i: number) => st.s.rows[i]) : st.s.rows;
}

// SVG markup for the current view (null when the view is not a picture).
export function viewSvgString(st: Store): string | null {
  if (st.view === 'gantt') {
    return C.gantt({ p: st.p, s: st.s, rows: gridItems(st), zoom: st.zoom, critical: st.critical, table: true, flat: st.group !== 'none', baseline: st.showBaseline && !!st.p.baseline }).svg;
  }
  if (!st.s.rows.length && st.view !== 'org') return null;
  if (st.view === 'network') {
    const sr = st.netScope === 'all' ? null : st.s.rows.find((x: any) => String(x.task.uid) === String(st.netScope));
    const title = sr ? sr.wbs + ' ' + sr.task.name : st.p.name + ' — activity network';
    return C.network({ p: st.p, s: st.s, rows: scopeRows(st), critical: st.critical, dates: st.netDates, title }).svg;
  }
  if (st.view === 'wbs') return C.wbs({ p: st.p, s: st.s, depth: st.wbsDepth }).svg;
  if (st.view === 'org') {
    const people = st.p.resources.filter(r => r.kind === 'Work');
    return people.length ? C.org({ p: { resources: people, currency: st.p.currency } }).svg : null;
  }
  return null;
}

export const hasImage = (st: Store) => ['gantt', 'network', 'wbs', 'org'].includes(st.view);

function svgElement(str: string): SVGSVGElement {
  return new DOMParser().parseFromString(str, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

// Replaces the open project's plan (e.g. restoring a version); Undo brings the previous plan back.
export function loadProject(p: Project, msg: string) {
  S().setUI({ backstage: false, menu: null });
  S().replaceProject(p, msg);
}

export function openTemplate(t: Template) {
  ask('Create a new project from the “' + t.name + '” template?',
    () => { void createProject(fromTemplate(t), 'New project created from the ' + t.name + ' template'); }, 'Create project');
}

export function runAction(a: string) {
  const st = S(), name = U.slug(st.p.name);
  st.setUI({ menu: null, backstage: false });
  switch (a) {
    case 'new':
      ask('Create a new blank project?', () => { void createProject(OP.model.blank(), 'New project created'); }, 'Create project');
      break;
    case 'sample':
      ask('Create a new project from the sample plan?', () => { void createProject(OP.demo(), 'Sample project created'); }, 'Create project');
      break;
    case 'projects': void st.closeProject(); break;
    case 'open':
      if (!userCanCreate()) { st.toast('Only admins and project managers can create projects from files.', true); break; }
      if (FS) openFile(); else pickFile(false);
      break;
    case 'insert': pickFile(true); break;
    case 'import': st.openDialog('import'); break;
    case 'share': st.openDialog('share'); break;
    case 'save': void st.saveNow(); break;
    case 'download': saveFile(false); break;
    case 'saveas': saveFile(true); break;
    case 'xlsx':
      U.download(name + '-tasks.xlsx', new Blob([toXlsx(IO.taskTable(st.p), 'Tasks')], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      st.toast('Excel file downloaded');
      break;
    case 'mspxml': U.download(name + '.xml', toMspXml(st.p), 'application/xml'); st.toast('Microsoft Project XML downloaded. In MS Project: File › Open and choose the .xml file.'); break;
    case 'csv': U.download(name + '-tasks.csv', '﻿' + IO.toCSV(st.p), 'text/csv'); st.toast('CSV downloaded'); break;
    case 'png': case 'svg': {
      const svg = viewSvgString(st);
      if (!svg) { st.toast('Switch to Gantt, Network, WBS or Team Chart to export an image.'); return; }
      if (a === 'png') IO.exportPNG(svgElement(svg), name + '-' + st.view);
      else IO.exportSVG(svgElement(svg), name + '-' + st.view);
      break;
    }
    case 'print': {
      const svg = viewSvgString(st);
      if (svg) IO.printSVG(svgElement(svg), st.p.name + ' — ' + VIEW_NAMES[st.view]);
      else window.print();
      break;
    }
    case 'settings': st.openDialog('settings'); break;
    case 'about': st.openDialog('about'); break;
  }
}

function pickFile(insert: boolean) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.neoproject,.json,.xml,application/json,application/xml,text/xml';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try { checkSize(file); } catch (e: any) { S().toast('Could not open file: ' + e.message, true); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const st = S();
      try {
        const { project: p, note } = readProject(file.name, String(reader.result));
        if (insert) {
          let res = { uid: 0, warnings: [] as string[] };
          st.commit(pp => { res = IO.insertProject(pp, p); });
          st.select([res.uid], res.uid);
          const notes = res.warnings.concat(note ? [note.replace(/^\. Note: /, '')] : []);
          st.toast('Inserted ' + file.name + ' as a subproject' + (notes.length ? '. Note: ' + notes.join('; ') + '.' : ''), notes.length > 0);
        } else void createProject(p, 'Opened ' + file.name + ' as a new project' + note);
      } catch (e: any) {
        st.toast('Could not open file: ' + e.message, true);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
