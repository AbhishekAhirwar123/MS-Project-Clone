import OP from '../core';
import type { LagUnit, LinkType, Project, Task } from '../types';

/*
 * Microsoft Project XML (MSPDI) import and export, the format MS Project reads and writes through
 * File > Save As > XML. Lag and rate units follow the MSPDI conventions: link lag is stored in tenths
 * of a minute, durations as ISO 8601 (PT40H0M0S).
 */

const U = OP.util, M = OP.model;

/* ---------- a small XML reader (no DOM needed, so it also runs in tests) ---------- */

interface XNode { name: string; text: string; kids: XNode[] }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

export function parseXml(src: string): XNode {
  const body = src.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const root: XNode = { name: '#root', text: '', kids: [] };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[6] != null) top.text += decode(m[6]);
    else if (m[2]) {
      if (stack.length > 1 && top.name === m[3].replace(/^.*:/, '')) stack.pop();
      else throw new Error('The XML is malformed (unexpected closing tag </' + m[3] + '>).');
    } else {
      const node: XNode = { name: m[3].replace(/^.*:/, ''), text: '', kids: [] };
      top.kids.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  if (stack.length > 1) throw new Error('The XML is malformed (unclosed <' + stack[stack.length - 1].name + '>).');
  if (!root.kids.length) throw new Error('The file is empty.');
  return root.kids[0];
}

const kid = (n: XNode | undefined, name: string) => n?.kids.find(k => k.name === name);
const kids = (n: XNode | undefined, name: string) => (n ? n.kids.filter(k => k.name === name) : []);
const txt = (n: XNode | undefined, name: string) => (kid(n, name)?.text ?? '').trim();
const numOf = (n: XNode | undefined, name: string, d = 0) => { const v = parseFloat(txt(n, name)); return isFinite(v) ? v : d; };
const flag = (n: XNode | undefined, name: string, d = false) => { const v = txt(n, name); return v === '' ? d : v === '1' || v.toLowerCase() === 'true'; };
const dateOf = (s: string) => { const d = U.parseDate(s.slice(0, 10)); return d == null ? '' : U.iso(d); };

/* ---------- code tables ---------- */

const CONSTRAINT_OUT: Record<string, number> = { ASAP: 0, ALAP: 1, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };
const CONSTRAINT_IN = Object.fromEntries(Object.entries(CONSTRAINT_OUT).map(([k, v]) => [v, k]));
const TYPE_OUT: Record<string, number> = { FixedUnits: 0, FixedDuration: 1, FixedWork: 2 };
const TYPE_IN = ['FixedUnits', 'FixedDuration', 'FixedWork'];
const LINK_OUT: Record<LinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
const LINK_IN: LinkType[] = ['FF', 'FS', 'SF', 'SS'];
// DurationFormat / LagFormat codes: 3 min, 5 hr, 7 day, 9 wk, 11 mo, and the elapsed forms 4, 6, 8, 10, 12.
const ELAPSED_FORMATS = new Set([4, 6, 8, 10, 12, 20]);
const LAG_PERCENT = 19, LAG_ELAPSED_DAYS = 8, LAG_DAYS = 7;

/* ---------- export ---------- */

const esc = (s: unknown) => U.esc(s).replace(/&#39;/g, '&apos;');
const el = (name: string, v: unknown) => '<' + name + '>' + esc(v) + '</' + name + '>';
const pad = (n: number) => String(n).padStart(2, '0');

function isoDuration(hours: number) {
  const mins = Math.round(hours * 60);
  return 'PT' + Math.floor(mins / 60) + 'H' + (mins % 60) + 'M0S';
}

export function toMspXml(p: Project): string {
  const s = OP.schedule(p), hpd = +p.hoursPerDay || 8, mpd = Math.round(hpd * 60);
  const rows = s.rows, byUid: Record<number, any> = {};
  rows.forEach((r: any) => { byUid[r.task.uid] = r; });
  const startH = 8, endH = Math.min(23, startH + hpd);
  const at = (iso: string, h: number) => iso + 'T' + pad(Math.floor(h)) + ':' + pad(Math.round((h % 1) * 60)) + ':00';
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Project xmlns="http://schemas.microsoft.com/project">'];

  out.push(el('SaveVersion', 14), el('Name', (p.name || 'Project') + '.xml'), el('Title', p.name));
  if (p.organization) out.push(el('Company', p.organization));
  if (p.manager) out.push(el('Manager', p.manager));
  out.push(el('ScheduleFromStart', p.scheduleFrom === 'finish' ? 0 : 1));
  out.push(el('StartDate', at(U.iso(s.startDn), startH)), el('FinishDate', at(U.iso(s.finishDn), endH)));
  out.push(el('CriticalSlackLimit', p.criticalSlack || 0));
  out.push(el('CurrencySymbol', p.currency || ''));
  out.push(el('CalendarUID', 1), el('DefaultStartTime', pad(startH) + ':00:00'), el('DefaultFinishTime', pad(endH) + ':00:00'));
  out.push(el('MinutesPerDay', mpd), el('MinutesPerWeek', mpd * 5), el('DaysPerMonth', 20));
  if (p.statusDate) out.push(el('StatusDate', at(p.statusDate, endH)));

  // Calendar: the work week and the exceptions.
  const shift = (from: number, to: number) => '<WorkingTime>' + el('FromTime', pad(from) + ':00:00') + el('ToTime', pad(to) + ':00:00') + '</WorkingTime>';
  const times = hpd === 8 ? shift(8, 12) + shift(13, 17) : shift(startH, endH);
  out.push('<Calendars><Calendar>', el('UID', 1), el('Name', 'Standard'), el('IsBaseCalendar', 1), '<WeekDays>');
  for (let d = 0; d < 7; d++) {
    const on = p.workDays.includes(d);
    out.push('<WeekDay>' + el('DayType', d + 1) + el('DayWorking', on ? 1 : 0) + (on ? '<WorkingTimes>' + times + '</WorkingTimes>' : '') + '</WeekDay>');
  }
  out.push('</WeekDays>');
  if (p.exceptions.length) {
    out.push('<Exceptions>');
    p.exceptions.forEach(x => {
      out.push('<Exception>' + el('EnteredByOccurrences', 0) + '<TimePeriod>' + el('FromDate', at(x.from, 0)) + el('ToDate', at(x.to, 23.98)) + '</TimePeriod>'
        + el('Occurrences', 1) + el('Name', x.name) + el('Type', 1) + el('DayWorking', x.working ? 1 : 0)
        + (x.working ? '<WorkingTimes>' + times + '</WorkingTimes>' : '') + '</Exception>');
    });
    out.push('</Exceptions>');
  }
  out.push('</Calendar></Calendars>');

  // Tasks
  out.push('<Tasks>');
  const idx = M.indexByUid(p);
  rows.forEach((r: any) => {
    const t: Task = r.task, summary = r.summary;
    const days = r.elapsed ? +t.duration || 0 : r.duration;
    const hours = r.elapsed ? days * 24 : days * hpd;
    const x: string[] = ['<Task>', el('UID', t.uid), el('ID', r.id), el('Name', t.name), el('Active', t.active ? 1 : 0), el('Manual', t.mode === 'manual' ? 1 : 0),
      el('Type', TYPE_OUT[t.type] ?? 0), el('WBS', r.wbs), el('OutlineNumber', r.wbs), el('OutlineLevel', t.level), el('Priority', t.priority),
      el('Start', at(U.iso(r.startDn), startH)), el('Finish', at(U.iso(r.finishDn), endH)), el('Duration', isoDuration(hours)),
      el('DurationFormat', r.elapsed ? 8 : 7)];
    if (t.mode === 'manual') x.push(el('ManualStart', at(U.iso(r.startDn), startH)), el('ManualFinish', at(U.iso(r.finishDn), endH)), el('ManualDuration', isoDuration(hours)));
    x.push(el('EffortDriven', t.effortDriven ? 1 : 0), el('Milestone', r.milestone ? 1 : 0), el('Summary', summary ? 1 : 0), el('Critical', r.critical && !summary ? 1 : 0),
      el('FixedCost', t.fixedCost || 0), el('PercentComplete', Math.round(r.percent)));
    if (t.actualStart) x.push(el('ActualStart', at(t.actualStart, startH)));
    if (t.actualFinish) x.push(el('ActualFinish', at(t.actualFinish, endH)));
    x.push(el('ConstraintType', CONSTRAINT_OUT[t.constraint] ?? 0));
    if (t.constraintDate && t.constraint !== 'ASAP' && t.constraint !== 'ALAP') x.push(el('ConstraintDate', at(t.constraintDate, startH)));
    if (t.deadline) x.push(el('Deadline', at(t.deadline, endH)));
    if (t.notes) x.push(el('Notes', t.notes));
    t.preds.forEach(l => {
      if (idx[l.uid] == null) return;
      const unit: LagUnit = l.unit || 'd';
      // Percent lag is stored in tenths of a percent; elapsed lag in elapsed minutes; working lag in working minutes.
      const tenths = unit === '%' ? l.lag * 10 : Math.round(l.lag * (unit === 'ed' ? 1440 : mpd) * 10);
      x.push('<PredecessorLink>' + el('PredecessorUID', l.uid) + el('Type', LINK_OUT[l.type]) + el('CrossProject', 0) + el('LinkLag', Math.round(tenths))
        + el('LagFormat', unit === '%' ? LAG_PERCENT : unit === 'ed' ? LAG_ELAPSED_DAYS : LAG_DAYS) + '</PredecessorLink>');
    });
    x.push('</Task>');
    out.push(x.join(''));
  });
  out.push('</Tasks>');

  // Resources
  out.push('<Resources>');
  p.resources.forEach((r, i) => {
    out.push('<Resource>' + el('UID', r.uid) + el('ID', i + 1) + el('Name', r.name) + el('Type', r.kind === 'Material' ? 0 : r.kind === 'Work' ? 1 : 2)
      + (r.initials ? el('Initials', r.initials) : '') + (r.kind === 'Material' && r.materialLabel ? el('MaterialLabel', r.materialLabel) : '')
      + el('MaxUnits', r.kind === 'Work' ? r.maxUnits / 100 : 1) + el('StandardRate', r.rate || 0) + el('StandardRateFormat', r.kind === 'Material' ? 0 : 2)
      + el('CostPerUse', r.costPerUse || 0) + '</Resource>');
  });
  out.push('</Resources>');

  // Assignments
  out.push('<Assignments>');
  let aid = 0;
  p.tasks.forEach(t => t.assignments.forEach(a => {
    const res = p.resources.find(r => r.uid === a.res);
    if (!res || idx[t.uid] == null) return;
    out.push('<Assignment>' + el('UID', ++aid) + el('TaskUID', t.uid) + el('ResourceUID', a.res)
      + el('Units', res.kind === 'Work' ? a.units / 100 : res.kind === 'Material' ? a.units : 0) + (res.kind === 'Cost' ? el('Cost', a.units) : '') + '</Assignment>');
  }));
  out.push('</Assignments>', '</Project>');
  return out.join('\n');
}

/* ---------- import ---------- */

// "PT40H0M0S" -> hours. Also accepts a day part ("P1DT4H") and fractional seconds.
function isoHours(s: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return NaN;
  return (+(m[1] || 0)) * 24 + (+(m[2] || 0)) + (+(m[3] || 0)) / 60 + (+(m[4] || 0)) / 3600;
}

export function fromMspXml(src: string): { project: Project; warnings: string[] } {
  const root = parseXml(src);
  if (root.name !== 'Project') throw new Error('Not a Microsoft Project XML file (expected a <Project> element).');
  const warnings: string[] = [];
  const p: Project = M.blank();
  const mpd = numOf(root, 'MinutesPerDay', 480) || 480, hpd = mpd / 60;
  p.name = (txt(root, 'Title') || txt(root, 'Name').replace(/\.xml$/i, '')) || 'Imported project';
  p.organization = txt(root, 'Company');
  p.manager = txt(root, 'Manager');
  p.hoursPerDay = Math.max(1, Math.min(24, Math.round(hpd * 100) / 100));
  p.start = dateOf(txt(root, 'StartDate')) || p.start;
  p.statusDate = dateOf(txt(root, 'StatusDate'));
  p.currency = txt(root, 'CurrencySymbol');
  p.criticalSlack = Math.max(0, numOf(root, 'CriticalSlackLimit', 0));
  p.issueDate = dateOf(txt(root, 'CreationDate')) || p.issueDate;
  if (!flag(root, 'ScheduleFromStart', true)) {
    p.scheduleFrom = 'finish';
    p.finishDate = dateOf(txt(root, 'FinishDate'));
    if (!p.finishDate) p.scheduleFrom = 'start';
  }

  // Calendar: the project's base calendar gives the work week and the exceptions.
  const cals = kids(kid(root, 'Calendars'), 'Calendar');
  const calUid = txt(root, 'CalendarUID');
  const cal = cals.find(c => txt(c, 'UID') === calUid) || cals.find(c => flag(c, 'IsBaseCalendar')) || cals[0];
  if (cal) {
    const days: number[] = [];
    const exceptions = kids(kid(cal, 'Exceptions'), 'Exception').map(e => ({ node: e, period: kid(e, 'TimePeriod') }));
    kids(kid(cal, 'WeekDays'), 'WeekDay').forEach(w => {
      const type = numOf(w, 'DayType', -1);
      if (type >= 1 && type <= 7) { if (flag(w, 'DayWorking')) days.push(type - 1); }
      else if (type === 0 && kid(w, 'TimePeriod')) exceptions.push({ node: w, period: kid(w, 'TimePeriod') });
    });
    if (days.length) p.workDays = days.sort();
    let recurring = 0;
    exceptions.forEach(({ node, period }) => {
      const from = dateOf(txt(period, 'FromDate')), to = dateOf(txt(period, 'ToDate')) || from;
      if (!from) return;
      if (flag(node, 'EnteredByOccurrences') && numOf(node, 'Occurrences', 1) > 1) recurring++;
      p.exceptions.push({ name: txt(node, 'Name') || 'Exception', from, to, working: flag(node, 'DayWorking') });
    });
    if (recurring) warnings.push(recurring + ' recurring calendar exception' + (recurring > 1 ? 's were' : ' was') + ' imported for its first occurrence only');
  }

  // Resources
  const resMap: Record<string, number> = {};
  const rateDivisor: Record<number, number> = { 1: 1 / 60, 2: 1, 3: hpd, 4: hpd * 5, 5: hpd * 20 };
  kids(kid(root, 'Resources'), 'Resource').forEach(rn => {
    const uid = txt(rn, 'UID');
    if (uid === '0' || flag(rn, 'IsNull')) return;
    const type = numOf(rn, 'Type', 1), kind = type === 0 ? 'Material' : type === 2 ? 'Cost' : 'Work';
    const rate = numOf(rn, 'StandardRate', 0), fmt = numOf(rn, 'StandardRateFormat', 2);
    const name = txt(rn, 'Name');
    const r = M.newResource(p, {
      name, kind, initials: txt(rn, 'Initials') || M.initials(name), materialLabel: txt(rn, 'MaterialLabel'),
      maxUnits: Math.max(1, Math.round(numOf(rn, 'MaxUnits', 1) * 100)),
      rate: kind === 'Material' ? rate : Math.round(rate / (rateDivisor[fmt] || 1) * 100) / 100,
      costPerUse: numOf(rn, 'CostPerUse', 0)
    });
    p.resources.push(r);
    resMap[uid] = r.uid;
  });

  // Tasks
  const taskMap: Record<string, number> = {};
  const links: { to: Task; node: XNode }[] = [];
  let skipped = 0, lost = 0;
  kids(kid(root, 'Tasks'), 'Task').forEach(tn => {
    const uid = txt(tn, 'UID');
    if (uid === '0' || flag(tn, 'IsNull')) return;
    const level = Math.max(1, Math.round(numOf(tn, 'OutlineLevel', 1)));
    const summary = flag(tn, 'Summary'), milestone = flag(tn, 'Milestone');
    const hours = isoHours(txt(tn, 'Duration'));
    const fmt = numOf(tn, 'DurationFormat', 7), elapsed = ELAPSED_FORMATS.has(fmt);
    let duration = isFinite(hours) ? (elapsed ? hours / 24 : hours / hpd) : 1;
    duration = milestone ? 0 : Math.round(duration * 100) / 100;
    const ct = CONSTRAINT_IN[numOf(tn, 'ConstraintType', 0)] || 'ASAP';
    const cdate = dateOf(txt(tn, 'ConstraintDate'));
    const fields: Partial<Task> = {
      name: txt(tn, 'Name'), level, duration, milestone, elapsed: elapsed && duration > 0 && !summary,
      percent: Math.max(0, Math.min(100, numOf(tn, 'PercentComplete', 0))), notes: txt(tn, 'Notes'),
      constraint: cdate || ct === 'ASAP' || ct === 'ALAP' ? ct : 'ASAP', constraintDate: ct === 'ASAP' || ct === 'ALAP' ? '' : cdate,
      deadline: dateOf(txt(tn, 'Deadline')), type: TYPE_IN[numOf(tn, 'Type', 0)] || 'FixedUnits', effortDriven: flag(tn, 'EffortDriven', true),
      fixedCost: numOf(tn, 'FixedCost', 0), priority: Math.max(0, Math.min(1000, numOf(tn, 'Priority', 500))),
      actualStart: dateOf(txt(tn, 'ActualStart')), actualFinish: dateOf(txt(tn, 'ActualFinish')), active: flag(tn, 'Active', true)
    };
    if (flag(tn, 'Manual')) {
      fields.mode = 'manual';
      fields.manualStart = dateOf(txt(tn, 'ManualStart') || txt(tn, 'Start'));
      const md = isoHours(txt(tn, 'ManualDuration'));
      if (isFinite(md) && !milestone) fields.duration = Math.round(md / hpd * 100) / 100;
    }
    const t = M.newTask(p, fields);
    p.tasks.push(t);
    taskMap[uid] = t.uid;
    if (kids(tn, 'PredecessorLink').length) links.push({ to: t, node: tn });
    if (kid(tn, 'ExternalTask') && flag(tn, 'ExternalTask')) skipped++;
    if (kids(tn, 'Baseline').length || kids(tn, 'TimephasedData').length || kids(tn, 'ExtendedAttribute').length) lost++;
  });

  // Links, once every task has its new id
  let badLinks = 0;
  links.forEach(({ to, node }) => {
    kids(node, 'PredecessorLink').forEach(ln => {
      const from = taskMap[txt(ln, 'PredecessorUID')];
      if (from == null || from === to.uid || flag(ln, 'CrossProject')) { badLinks++; return; }
      const fmt = numOf(ln, 'LagFormat', LAG_DAYS), tenths = numOf(ln, 'LinkLag', 0);
      const link: { uid: number; type: LinkType; lag: number; unit?: LagUnit } = {
        uid: from, type: LINK_IN[numOf(ln, 'Type', 1)] || 'FS', lag: 0
      };
      if (fmt === LAG_PERCENT || fmt === 20) { link.lag = Math.round(tenths / 10 * 100) / 100; link.unit = '%'; }
      else if (ELAPSED_FORMATS.has(fmt)) { link.lag = Math.round(tenths / 10 / 1440 * 100) / 100; link.unit = 'ed'; }
      else link.lag = Math.round(tenths / 10 / mpd * 100) / 100;
      if (!link.lag) delete link.unit;
      to.preds.push(link);
    });
  });
  if (badLinks) warnings.push(badLinks + ' link' + (badLinks > 1 ? 's' : '') + ' to other projects or missing tasks were skipped');

  // Assignments
  let badAsg = 0;
  kids(kid(root, 'Assignments'), 'Assignment').forEach(an => {
    const tuid = taskMap[txt(an, 'TaskUID')], ruid = resMap[txt(an, 'ResourceUID')];
    const t = p.tasks.find(x => x.uid === tuid), res = p.resources.find(x => x.uid === ruid);
    if (!t || !res) { if (txt(an, 'ResourceUID') !== '-65535') badAsg++; return; }
    if (t.assignments.some(a => a.res === res.uid)) return;
    const units = res.kind === 'Work' ? Math.round(numOf(an, 'Units', 1) * 100) : res.kind === 'Material' ? numOf(an, 'Units', 1) : numOf(an, 'Cost', 0);
    t.assignments.push({ res: res.uid, units });
  });
  if (badAsg) warnings.push(badAsg + ' assignment' + (badAsg > 1 ? 's' : '') + ' could not be matched to a task and resource');
  if (skipped) warnings.push(skipped + ' task' + (skipped > 1 ? 's' : '') + ' from other projects ' + (skipped > 1 ? 'were' : 'was') + ' imported as plain tasks');
  if (lost) warnings.push('baselines, timephased data and extended attributes are not imported');

  if (!p.tasks.length) throw new Error('The file has no tasks.');
  return { project: M.normalize(p), warnings };
}
