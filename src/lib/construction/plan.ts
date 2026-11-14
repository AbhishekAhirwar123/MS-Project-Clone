import OP from '../../core';
import type {
  CalException, CxLocation, CxLocationType, CxPerson, CxUnit, LinkType, Project, ProjectConstruction, Task, TaskConstruction
} from '../../types';
import {
  CATALOGUE, CATALOGUE_KEY, CATALOGUE_VERSION, RELEASE_KEY, RULES, SERVICE_KEYS, isUnit, unitLabel, type CatalogueActivity, type GroupKey
} from './catalogue';

/*
 * The "Create building plan" workflow, without any UI: a draft holds everything the wizard collects, and the
 * functions below derive locations, activity instances, durations, proposed dependencies, problems and finally
 * an ordinary Neo Project plan. Scheduling itself is left to the existing engine (core.js).
 */

const M = OP.model, U = OP.util;

/* ---------- draft ---------- */

export interface PlanActivity {
  key: string;
  name: string;
  group: GroupKey;
  unit: CxUnit | '';
  milestone: boolean;
  custom: boolean;
  scope: CatalogueActivity['scope'];
  enabled: boolean;
  locationIds: string[];            // top-level locations that get this activity (unused for scope "auto")
  splits: Record<string, string[]>; // top-level location id -> the zones it is split into; none = one activity for the whole location
}

export type DurationMode = 'manual' | 'quantity';
export interface InstanceConfig {
  mode: DurationMode;
  quantity: string;
  unit: CxUnit | '';
  productivity: string; // unit per crew working day
  duration: string;     // working days, manual mode
  contractor: string;
  crew: string;
  engineerId: string;   // '' = unassigned
  notes: string;
}

export interface AddedLink { from: string; to: string; type: LinkType; lag: number }

export interface PlanDraft {
  requestId: string; // sent with the create request so a repeated submission cannot create a second plan
  name: string;
  building: { id: string; name: string };
  start: string;
  workDays: number[];
  exceptions: CalException[];
  engineerId: string;
  locations: CxLocation[];
  activities: PlanActivity[];
  config: Record<string, InstanceConfig>; // by instance id; kept when an instance is deselected so its input comes back
  removedLinks: string[];
  changedLinks: Record<string, { type: LinkType; lag: number }>;
  addedLinks: AddedLink[];
}

export function randomId(): string {
  const a = new Uint8Array(12);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

export function newDraft(start: string, requestId = randomId()): PlanDraft {
  const building = { id: 'bld-1', name: 'Tower A' };
  // Outside plaster and façade paint are planned once for the building, not repeated on every floor.
  const locations = addTopLocation(syncLevels([], { basements: 0, ground: true, floors: 2, terrace: false }, building.id), 'building_works', 'Façade and external works', building.id);
  const d: PlanDraft = {
    requestId, name: '', building, start, workDays: [], exceptions: [], engineerId: '', locations,
    activities: CATALOGUE.map(a => ({
      key: a.key, name: a.name, group: a.group, unit: a.unit, milestone: a.milestone, custom: false, scope: a.scope,
      enabled: a.defaultOn, locationIds: [], splits: {}
    })),
    config: {}, removedLinks: [], changedLinks: {}, addedLinks: []
  };
  d.activities.forEach(a => { a.locationIds = defaultLocationIds(a.scope, locations); });
  return d;
}

/* ---------- locations ---------- */

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh',
  'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth'];
export function floorName(n: number) {
  if (n <= ORDINALS.length) return ORDINALS[n - 1] + ' floor';
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return n + s + ' floor';
}

export const LOCATION_TYPES: Record<CxLocationType, string> = {
  basement: 'Basement', ground: 'Ground floor', floor: 'Floor', terrace: 'Terrace', common: 'Common area',
  building_works: 'Building-level works', zone: 'Flat / zone'
};
const FLOOR_LIKE: CxLocationType[] = ['basement', 'ground', 'floor'];

export interface LevelCounts { basements: number; ground: boolean; floors: number; terrace: boolean }
export const MAX_LEVELS = 60;

export function levelCounts(locs: CxLocation[]): LevelCounts {
  return {
    basements: locs.filter(l => l.type === 'basement').length, ground: locs.some(l => l.type === 'ground'),
    floors: locs.filter(l => l.type === 'floor').length, terrace: locs.some(l => l.type === 'terrace')
  };
}

// Rebuilds the generated levels (basements, ground, numbered floors, terrace) for new counts. Levels that
// survive keep their id and any name or code you typed; common areas, building-level works and zones are kept.
export function syncLevels(locs: CxLocation[], c: LevelCounts, buildingId: string): CxLocation[] {
  const byId = new Map(locs.map(l => [l.id, l]));
  const make = (id: string, type: CxLocationType, code: string, name: string): CxLocation =>
    byId.get(id) || { id, buildingId, parentId: null, type, code, name };
  const levels: CxLocation[] = [];
  const nb = clampCount(c.basements), nf = clampCount(c.floors);
  for (let i = nb; i >= 1; i--) levels.push(make('loc-B' + i, 'basement', 'B' + i, 'Basement ' + i));
  if (c.ground) levels.push(make('loc-GF', 'ground', 'GF', 'Ground floor'));
  for (let i = 1; i <= nf; i++) levels.push(make('loc-F' + i, 'floor', 'F' + i, floorName(i)));
  if (c.terrace) levels.push(make('loc-T', 'terrace', 'T', 'Terrace'));
  const others = locs.filter(l => l.parentId === null && !['basement', 'ground', 'floor', 'terrace'].includes(l.type));
  const tops = levels.concat(others), keep = new Set(tops.map(l => l.id));
  const out: CxLocation[] = [];
  tops.forEach(t => { out.push(t); locs.forEach(z => { if (z.parentId === t.id && keep.has(t.id)) out.push(z); }); });
  return out;
}
const clampCount = (n: number) => Math.max(0, Math.min(MAX_LEVELS, Math.floor(+n || 0)));

function nextId(locs: CxLocation[], prefix: string) {
  let n = 1;
  while (locs.some(l => l.id === prefix + n)) n++;
  return prefix + n;
}

export function addTopLocation(locs: CxLocation[], type: 'common' | 'building_works', name: string, buildingId: string): CxLocation[] {
  const id = nextId(locs, type === 'common' ? 'loc-CA' : 'loc-EX');
  const code = (type === 'common' ? 'CA' : 'EX') + id.replace(/^\D+/, '');
  return locs.concat([{ id, buildingId, parentId: null, type, code, name }]);
}

export function addZone(locs: CxLocation[], parentId: string, name: string): CxLocation[] {
  const parent = locs.find(l => l.id === parentId);
  if (!parent) return locs;
  const id = nextId(locs, parentId + '-Z');
  const zone: CxLocation = { id, buildingId: parent.buildingId, parentId, type: 'zone', code: 'Z' + id.slice(parentId.length + 2), name };
  const at = locs.findIndex(l => l.id === parentId) + 1 + zonesOf(locs, parentId).length;
  return locs.slice(0, at).concat([zone], locs.slice(at));
}

export function removeLocation(locs: CxLocation[], id: string): CxLocation[] {
  return locs.filter(l => l.id !== id && l.parentId !== id);
}

export const topLocations = (locs: CxLocation[]) => locs.filter(l => l.parentId === null);
export const zonesOf = (locs: CxLocation[], id: string) => locs.filter(l => l.parentId === id);

// Field problems by location id: names and codes must be filled in and unique within their parent.
export function locationProblems(locs: CxLocation[]): Record<string, { name?: string; code?: string }> {
  const out: Record<string, { name?: string; code?: string }> = {};
  const put = (id: string, k: 'name' | 'code', msg: string) => { (out[id] ||= {})[k] = out[id][k] || msg; };
  const groups = new Map<string, CxLocation[]>();
  locs.forEach(l => { const k = l.parentId || ''; groups.set(k, (groups.get(k) || []).concat([l])); });
  groups.forEach(list => {
    const seen = { name: new Map<string, string>(), code: new Map<string, string>() };
    list.forEach(l => {
      (['name', 'code'] as const).forEach(k => {
        const v = l[k].trim().toLowerCase();
        if (!v) { put(l.id, k, k === 'name' ? 'Enter a name' : 'Enter a code'); return; }
        if (k === 'code' && !/^[a-z0-9][a-z0-9 ._/-]{0,15}$/i.test(l.code.trim())) { put(l.id, k, 'Use up to 16 letters, digits, spaces or . _ / -'); return; }
        const first = seen[k].get(v);
        if (first) { put(l.id, k, 'Same ' + k + ' as another location here'); put(first, k, 'Same ' + k + ' as another location here'); }
        else seen[k].set(v, l.id);
      });
    });
  });
  return out;
}

export function defaultLocationIds(scope: CatalogueActivity['scope'], locs: CxLocation[]): string[] {
  if (scope === 'auto') return [];
  const types: CxLocationType[] = scope === 'external' ? ['building_works'] : FLOOR_LIKE;
  return topLocations(locs).filter(l => types.includes(l.type)).map(l => l.id);
}

// After locations change: forget removed ones, and give newly added floors (or building-level works) to the
// activities that were on every existing location of that kind, so "all floors" stays all floors.
export function reconcileLocations(d: PlanDraft, locs: CxLocation[]): PlanDraft {
  const ids = new Set(locs.map(l => l.id));
  const before = new Set(d.locations.map(l => l.id));
  const added = topLocations(locs).filter(l => !before.has(l.id));
  const activities = d.activities.map(a => {
    const kinds: CxLocationType[] = a.scope === 'external' ? ['building_works'] : FLOOR_LIKE;
    const oldOfKind = topLocations(d.locations).filter(l => kinds.includes(l.type)).map(l => l.id);
    const hadAll = oldOfKind.length > 0 && oldOfKind.every(id => a.locationIds.includes(id));
    let locationIds = a.locationIds.filter(id => ids.has(id));
    if (a.scope !== 'auto' && (hadAll || (!oldOfKind.length && a.enabled && !a.locationIds.length))) {
      locationIds = locationIds.concat(added.filter(l => kinds.includes(l.type)).map(l => l.id));
    }
    const splits: Record<string, string[]> = {};
    Object.entries(a.splits).forEach(([top, zs]) => { if (ids.has(top)) { const keep = zs.filter(z => ids.has(z)); if (keep.length) splits[top] = keep; } });
    return { ...a, locationIds: topLocations(locs).map(l => l.id).filter(id => locationIds.includes(id)), splits };
  });
  return { ...d, locations: locs, activities };
}

export function locationName(locs: CxLocation[], id: string): string {
  const l = locs.find(x => x.id === id);
  if (!l) return '(missing location)';
  if (!l.parentId) return l.name;
  return locationName(locs, l.parentId) + ' / ' + l.name;
}

/* ---------- activity instances ---------- */

export interface Instance {
  id: string;           // "<activity key>@<location id>"; a split parent is "<key>@<top id>#split"
  key: string;
  locationId: string;
  topId: string;
  zoneId: string | null;
  milestone: boolean;
  executable: boolean;  // false for the summary over a split activity's zone tasks
  parentId: string | null;
}

export const instanceId = (key: string, locationId: string) => key + '@' + locationId;

export function activityOf(d: PlanDraft, key: string) { return d.activities.find(a => a.key === key); }

// One instance per activity per chosen location, or one per chosen zone when the activity is split there,
// never both: a split location's scope lives only on its zone tasks. Order follows the display order.
export function instancesOf(d: PlanDraft): Instance[] {
  const out: Instance[] = [];
  const on = d.activities.filter(a => a.enabled);
  const zoneIds = new Set(d.locations.filter(l => l.type === 'zone').map(l => l.id));
  topLocations(d.locations).forEach(top => {
    on.forEach(a => {
      if (a.scope === 'auto') {
        if (a.key === RELEASE_KEY && on.some(s => SERVICE_KEYS.includes(s.key) && s.locationIds.includes(top.id))) {
          out.push({ id: instanceId(a.key, top.id), key: a.key, locationId: top.id, topId: top.id, zoneId: null, milestone: true, executable: true, parentId: null });
        }
        return;
      }
      if (!a.locationIds.includes(top.id)) return;
      const zones = a.milestone ? [] : (a.splits[top.id] || []).filter(z => zoneIds.has(z) && d.locations.some(l => l.id === z && l.parentId === top.id));
      if (!zones.length) {
        out.push({ id: instanceId(a.key, top.id), key: a.key, locationId: top.id, topId: top.id, zoneId: null, milestone: a.milestone, executable: true, parentId: null });
        return;
      }
      const parent = instanceId(a.key, top.id) + '#split';
      out.push({ id: parent, key: a.key, locationId: top.id, topId: top.id, zoneId: null, milestone: false, executable: false, parentId: null });
      zones.forEach(z => out.push({ id: instanceId(a.key, z), key: a.key, locationId: z, topId: top.id, zoneId: z, milestone: false, executable: true, parentId: parent }));
    });
  });
  return out;
}

export function instanceLabel(d: PlanDraft, inst: Instance) {
  return (activityOf(d, inst.key)?.name || inst.key) + ' — ' + locationName(d.locations, inst.locationId);
}

/* ---------- configuration and durations ---------- */

export function blankConfig(a: Pick<PlanActivity, 'unit' | 'milestone'> | undefined): InstanceConfig {
  return {
    mode: a && a.unit && !a.milestone ? 'quantity' : 'manual', quantity: '', unit: a?.unit || '', productivity: '',
    duration: a?.milestone ? '0' : '', contractor: '', crew: '', engineerId: '', notes: ''
  };
}
export const configOf = (d: PlanDraft, inst: Pick<Instance, 'id' | 'key'>): InstanceConfig => d.config[inst.id] || blankConfig(activityOf(d, inst.key));

// Each instance gets its own copy, so changing one location never changes another.
export function patchConfigs(d: PlanDraft, insts: Pick<Instance, 'id' | 'key'>[], patch: Partial<InstanceConfig>): PlanDraft {
  const config = { ...d.config };
  insts.forEach(i => { config[i.id] = { ...configOf(d, i), ...patch }; });
  return { ...d, config };
}

// '' -> null (not entered), a non-negative number, or NaN for anything else.
function numberOrBlank(s: string): number | null {
  const t = String(s ?? '').replace(/,/g, '').trim();
  if (!t) return null;
  const v = Number(t);
  return isFinite(v) && v >= 0 ? v : NaN;
}

const fmtNum = (v: number, dp = 2) => v.toLocaleString('en-IN', { maximumFractionDigits: dp });

export type DurationResult =
  | { ok: true; days: number; calc: string }
  | { ok: false; errors: Partial<Record<'duration' | 'quantity' | 'productivity' | 'unit', string>> };

// Planned duration in working days on the project's site calendar. Quantity-based durations are
// quantity ÷ output per crew working day, rounded to 0.01 day like any duration typed into the plan.
// Crew count does not multiply output.
export function durationOf(cfg: InstanceConfig, milestone: boolean): DurationResult {
  const errors: Partial<Record<'duration' | 'quantity' | 'productivity' | 'unit', string>> = {};
  if (milestone) return { ok: true, days: 0, calc: 'Milestone: zero duration' };
  const q = numberOrBlank(cfg.quantity), r = numberOrBlank(cfg.productivity);
  if (cfg.mode === 'quantity') {
    if (q == null) errors.quantity = 'Enter the planned quantity';
    else if (!(q > 0)) errors.quantity = 'Enter a quantity greater than 0';
    if (r == null) errors.productivity = 'Enter the expected output per crew working day';
    else if (!(r > 0)) errors.productivity = 'Enter an output greater than 0';
    if (!isUnit(cfg.unit)) errors.unit = 'Choose a unit';
    if (Object.keys(errors).length) return { ok: false, errors };
    const raw = q! / r!;
    const days = M.parseDuration(raw.toFixed(10)) as number;
    if (!(days >= 0.01)) return { ok: false, errors: { productivity: 'This works out to less than 0.01 working day' } };
    const unit = unitLabel(cfg.unit);
    const rounded = Math.abs(days - raw) > 1e-9;
    return {
      ok: true, days,
      calc: fmtNum(q!) + ' ' + unit + ' ÷ ' + fmtNum(r!) + ' ' + unit + ' per crew working day = ' + fmtNum(raw, 4) + ' → ' + fmtNum(days) +
        ' working day' + (days === 1 ? '' : 's') + (rounded ? ' (rounded to 0.01 day, the precision the scheduler keeps)' : '')
    };
  }
  if (q !== null && isNaN(q)) errors.quantity = 'Enter a number, or leave it blank';
  if (r !== null && isNaN(r)) errors.productivity = 'Enter a number, or leave it blank';
  const parsed = String(cfg.duration ?? '').trim() ? M.parseDurationEx(cfg.duration, 8) : null;
  if (!String(cfg.duration ?? '').trim()) errors.duration = 'Enter a duration in working days';
  else if (!parsed) errors.duration = 'Enter working days, e.g. 12 or 2w';
  else if (parsed.elapsed) errors.duration = 'Use working days; calendar days are not used here';
  else if (!(parsed.days > 0)) errors.duration = 'Enter a duration greater than 0 (use a milestone for zero)';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, days: parsed!.days, calc: 'Entered: ' + fmtNum(parsed!.days) + ' working day' + (parsed!.days === 1 ? '' : 's') };
}

// Totals per activity and unit. Quantities in different units are never added together.
export function quantityTotals(d: PlanDraft, insts: Instance[]) {
  const out = new Map<string, Map<string, { total: number; count: number }>>();
  insts.filter(i => i.executable && !i.milestone).forEach(i => {
    const cfg = configOf(d, i), q = numberOrBlank(cfg.quantity);
    if (q == null || isNaN(q) || !isUnit(cfg.unit)) return;
    const byUnit = out.get(i.key) || new Map();
    const cur = byUnit.get(cfg.unit) || { total: 0, count: 0 };
    byUnit.set(cfg.unit, { total: cur.total + q, count: cur.count + 1 });
    out.set(i.key, byUnit);
  });
  return out;
}

/* ---------- dependencies ---------- */

export interface PlanLink {
  id: string;           // "<from instance>><to instance>"
  from: string;
  to: string;
  type: LinkType;
  lag: number;
  reason: string;
  origin: 'template' | 'added';
  mapping?: string;     // how a floor-level prerequisite was mapped onto zone tasks, or the other way round
  edited?: boolean;
}
export const linkId = (from: string, to: string) => from + '>' + to;

// Template relationships, applied only between activities selected in the same top-level location.
// A missing (deselected) activity simply produces no link: nothing is re-routed around it.
export function proposedLinks(d: PlanDraft, insts: Instance[]): PlanLink[] {
  const out: PlanLink[] = [], seen = new Set<string>();
  const name = (k: string) => activityOf(d, k)?.name || k;
  const zone = (i: Instance) => (i.zoneId ? d.locations.find(l => l.id === i.zoneId)?.name || '' : '');
  const exec = insts.filter(i => i.executable);
  topLocations(d.locations).forEach(top => {
    RULES.forEach(rule => {
      const A = exec.filter(i => i.key === rule.from && i.topId === top.id);
      const B = exec.filter(i => i.key === rule.to && i.topId === top.id);
      if (!A.length || !B.length) return;
      const add = (a: Instance, b: Instance, mapping?: string) => {
        const id = linkId(a.id, b.id);
        if (seen.has(id)) return;
        seen.add(id);
        out.push({ id, from: a.id, to: b.id, type: rule.type, lag: rule.lag, reason: rule.reason, origin: 'template', mapping });
      };
      const aWhole = A.find(a => !a.zoneId);
      if (aWhole) {
        B.forEach(b => add(aWhole, b, b.zoneId ? name(rule.from) + ' is planned for all of ' + top.name + ', so each zone of ' + name(rule.to) + ' waits for it.' : undefined));
        return;
      }
      const bWhole = B.find(b => !b.zoneId);
      if (bWhole) {
        A.forEach(a => add(a, bWhole, name(rule.to) + ' is planned for all of ' + top.name + ', so it waits for every zone of ' + name(rule.from) + '.'));
        return;
      }
      B.forEach(b => {
        const same = A.find(a => a.zoneId === b.zoneId);
        if (same) add(same, b);
        else A.forEach(a => add(a, b, name(rule.from) + ' has no task for ' + zone(b) + ', so this zone waits for all its zones.'));
      });
    });
  });
  return out;
}

// The links that will be generated: proposals minus removals, with edits, plus links added during review.
export function finalLinks(d: PlanDraft, insts: Instance[]): { links: PlanLink[]; droppedAdded: number } {
  const exec = new Set(insts.filter(i => i.executable).map(i => i.id));
  const removed = new Set(d.removedLinks);
  const links = proposedLinks(d, insts).filter(l => !removed.has(l.id)).map(l => {
    const e = d.changedLinks[l.id];
    return e ? { ...l, type: e.type, lag: e.lag, edited: true } : l;
  });
  const added = d.addedLinks.filter(a => exec.has(a.from) && exec.has(a.to));
  added.forEach(a => links.push({ id: linkId(a.from, a.to), from: a.from, to: a.to, type: a.type, lag: a.lag, reason: 'Added during review.', origin: 'added' }));
  return { links, droppedAdded: d.addedLinks.length - added.length };
}

// A path of instance ids that forms a loop, or null.
export function findCycle(links: Pick<PlanLink, 'from' | 'to'>[]): string[] | null {
  const succ = new Map<string, string[]>();
  links.forEach(l => succ.set(l.from, (succ.get(l.from) || []).concat([l.to])));
  const state = new Map<string, 1 | 2>(), stack: string[] = [];
  let found: string[] | null = null;
  const visit = (n: string): boolean => {
    state.set(n, 1);
    stack.push(n);
    for (const m of succ.get(n) || []) {
      if (state.get(m) === 1) { found = stack.slice(stack.indexOf(m)).concat([m]); return true; }
      if (!state.has(m) && visit(m)) return true;
    }
    stack.pop();
    state.set(n, 2);
    return false;
  };
  for (const n of succ.keys()) if (!state.has(n) && visit(n)) break;
  return found;
}

// Problems with the dependency list, by link id ('' for problems that are not about one link).
export function linkProblems(d: PlanDraft, insts: Instance[], links: PlanLink[]): Record<string, string> {
  const out: Record<string, string> = {};
  const byId = new Map(insts.map(i => [i.id, i]));
  const counts = new Map<string, number>();
  links.forEach(l => counts.set(l.id, (counts.get(l.id) || 0) + 1));
  links.forEach(l => {
    const a = byId.get(l.from), b = byId.get(l.to);
    if (!a || !b) out[l.id] = 'Refers to an activity that is not in the plan';
    else if (!a.executable || !b.executable) out[l.id] = 'Link the zone activities, not the summary over them';
    else if (l.from === l.to) out[l.id] = 'An activity cannot depend on itself';
    else if ((counts.get(l.id) || 0) > 1) out[l.id] = 'Duplicate link';
    else if (!isFinite(l.lag) || Math.abs(l.lag) > 999) out[l.id] = 'Lag must be between −999 and 999 working days';
  });
  const loop = findCycle(links);
  if (loop) {
    const label = (id: string) => { const i = byId.get(id); return i ? instanceLabel(d, i) : id; };
    out[''] = 'Circular dependency: ' + loop.map(label).join(' → ');
    for (let k = 0; k + 1 < loop.length; k++) { const id = linkId(loop[k], loop[k + 1]); out[id] = out[id] || 'Part of a circular dependency'; }
  }
  return out;
}

// Why a new link cannot be added, or '' when it can.
export function addLinkProblem(insts: Instance[], links: PlanLink[], from: string, to: string): string {
  const exec = new Set(insts.filter(i => i.executable).map(i => i.id));
  if (!from || !to) return 'Choose both activities';
  if (!exec.has(from) || !exec.has(to)) return 'Choose activities from the plan';
  if (from === to) return 'An activity cannot depend on itself';
  if (links.some(l => l.from === from && l.to === to)) return 'That link already exists';
  if (findCycle(links.concat([{ from, to } as PlanLink]))) return 'That link would create a circular dependency';
  return '';
}

// Executable activities with no predecessor at all: the template has no safe default for them.
export function needsReview(insts: Instance[], links: PlanLink[]): Set<string> {
  const has = new Set(links.map(l => l.to));
  return new Set(insts.filter(i => i.executable && !has.has(i.id)).map(i => i.id));
}

/* ---------- checks before generating ---------- */

export interface Issue { level: 'error' | 'warning' | 'optional'; step: number; text: string }

export function planIssues(d: PlanDraft, insts: Instance[], links: PlanLink[]): Issue[] {
  const out: Issue[] = [];
  const add = (level: Issue['level'], step: number, text: string) => out.push({ level, step, text });
  if (!d.name.trim()) add('error', 0, 'Enter a project name.');
  if (!d.building.name.trim()) add('error', 0, 'Enter the building or tower name.');
  if (U.parseDate(d.start) == null) add('error', 0, 'Enter the project start date.');
  if (!d.workDays.length) add('error', 0, 'Choose the site’s working days.');
  d.exceptions.forEach(x => { if (U.parseDate(x.from) == null || U.parseDate(x.to || x.from) == null) add('error', 0, 'Calendar exception “' + (x.name || 'unnamed') + '” needs valid dates.'); });

  const tops = topLocations(d.locations);
  if (!tops.length) add('error', 1, 'Add at least one floor or building-level location.');
  const lp = locationProblems(d.locations);
  Object.keys(lp).forEach(id => add('error', 1, locationName(d.locations, id) + ': ' + Object.values(lp[id]).join('; ') + '.'));

  const on = d.activities.filter(a => a.enabled);
  if (!on.length) add('error', 2, 'Select at least one activity.');
  on.forEach(a => {
    if (!a.name.trim()) add('error', 2, 'An activity (' + a.key + ') has no name.');
    if (a.scope !== 'auto' && !a.locationIds.length) add('error', 2, (a.name || a.key) + ': choose at least one location, or deselect it.');
  });
  const release = on.find(a => a.key === RELEASE_KEY);
  tops.forEach(top => {
    const here = insts.filter(i => i.topId === top.id);
    if (!here.length) add('warning', 2, top.name + ' has no activities and will not appear in the plan.');
    const hasService = here.some(i => SERVICE_KEYS.includes(i.key));
    if (hasService && !release && here.some(i => i.key === 'inside_plaster')) {
      add('warning', 2, top.name + ': no concealed services review/release milestone is selected, so inside plaster gets no proposed predecessor there.');
    }
    // A split activity covers only the zones chosen for it.
    d.activities.filter(a => a.enabled && (a.splits[top.id] || []).length && a.locationIds.includes(top.id)).forEach(a => {
      const missing = zonesOf(d.locations, top.id).filter(z => !a.splits[top.id].includes(z.id));
      if (missing.length) add('warning', 2, a.name + ' on ' + top.name + ' is split by zone and leaves out ' + missing.map(z => z.name).join(', ') + '.');
    });
  });

  let missingContractor = 0, missingEngineer = 0;
  insts.filter(i => i.executable).forEach(i => {
    const cfg = configOf(d, i), r = durationOf(cfg, i.milestone);
    if (!r.ok) add('error', 3, instanceLabel(d, i) + ': ' + Object.values(r.errors).join('; ') + '.');
    if (!i.milestone && !cfg.contractor.trim()) missingContractor++;
    if (!i.milestone && !cfg.engineerId) missingEngineer++;
  });
  if (missingContractor) add('optional', 3, missingContractor + ' activit' + (missingContractor === 1 ? 'y has' : 'ies have') + ' no contractor yet.');
  if (missingEngineer) add('optional', 3, missingEngineer + ' activit' + (missingEngineer === 1 ? 'y has' : 'ies have') + ' no responsible engineer yet.');
  if (!d.engineerId) add('optional', 0, 'No project engineer is assigned.');

  const lpb = linkProblems(d, insts, links);
  Object.entries(lpb).forEach(([id, msg]) => {
    if (!id) { add('error', 4, msg + '.'); return; }
    const l = links.find(x => x.id === id);
    const byId = new Map(insts.map(i => [i.id, i]));
    const a = l && byId.get(l.from), b = l && byId.get(l.to);
    if (msg !== 'Part of a circular dependency') add('error', 4, (a ? instanceLabel(d, a) : l?.from) + ' → ' + (b ? instanceLabel(d, b) : l?.to) + ': ' + msg + '.');
  });
  return out;
}

/* ---------- generation ---------- */

export interface GenerateContext { users: { id: string; name: string }[]; generatedBy: CxPerson | null; now: string }
export type GenerateResult = { ok: true; project: Project } | { ok: false; errors: string[] };

export const REVIEW_NOTE = 'Generated draft. Dependencies, durations and release conditions are template proposals that the project engineer must review. A scheduled review/release milestone is not evidence that an inspection has passed.';

// Builds an ordinary Neo Project plan from the draft, or lists what still has to be fixed. Nothing is saved here.
export function generatePlan(d: PlanDraft, ctx: GenerateContext): GenerateResult {
  const insts = instancesOf(d);
  const { links } = finalLinks(d, insts);
  const errors = planIssues(d, insts, links).filter(i => i.level === 'error').map(i => i.text);
  if (!insts.some(i => i.executable)) errors.push('The plan has no activities to generate.');
  if (errors.length) return { ok: false, errors };

  const person = (id: string): CxPerson | null => { const u = ctx.users.find(x => x.id === id); return u ? { userId: u.id, name: u.name } : null; };
  const p: Project = M.blank();
  p.name = d.name.trim();
  p.start = d.start;
  p.issueDate = ctx.now.slice(0, 10);
  p.workDays = d.workDays.slice().sort();
  p.exceptions = d.exceptions.map(x => ({ name: x.name.trim() || (x.working ? 'Working time' : 'Non-working time'), from: x.from, to: x.to || x.from, working: !!x.working }));
  p.status = 'Draft';

  const contractors: { id: string; name: string }[] = [];
  const contractorId = (name: string) => {
    const n = name.trim();
    if (!n) return undefined;
    let c = contractors.find(x => x.name.toLowerCase() === n.toLowerCase());
    if (!c) { c = { id: 'con-' + (contractors.length + 1), name: n }; contractors.push(c); }
    return c.id;
  };
  const crews = new Map<string, number>();
  const crewUid = (name: string) => {
    const n = name.trim();
    if (!n) return undefined;
    const k = n.toLowerCase();
    if (!crews.has(k)) {
      const r = M.newResource(p, { name: n, initials: M.initials(n), role: 'Crew', type: 'Full-time', kind: 'Work' });
      p.resources.push(r);
      crews.set(k, r.uid);
    }
    return crews.get(k);
  };

  const bid = d.building.id;
  const tasks = new Map<string, Task>();
  const building = M.newTask(p, { name: d.building.name.trim(), level: 1, notes: REVIEW_NOTE });
  building.construction = { instanceId: 'building@' + bid, role: 'building', buildingId: bid } satisfies TaskConstruction;
  p.tasks.push(building);
  const review = needsReview(insts, links);
  const reasons = new Map<string, { from: string; reason: string }[]>();
  links.filter(l => l.origin === 'template').forEach(l => reasons.set(l.to, (reasons.get(l.to) || []).concat([{ from: l.from, reason: l.reason + (l.mapping ? ' ' + l.mapping : '') }])));

  topLocations(d.locations).forEach(top => {
    const here = insts.filter(i => i.topId === top.id);
    if (!here.length) return;
    const loc = M.newTask(p, { name: top.name.trim(), level: 2 });
    loc.construction = { instanceId: 'location@' + top.id, role: 'location', buildingId: bid, locationId: top.id };
    p.tasks.push(loc);
    here.forEach(i => {
      const a = activityOf(d, i.key)!;
      if (!i.executable) {
        const t = M.newTask(p, { name: a.name.trim(), level: 3 });
        t.construction = { instanceId: i.id, role: 'split', buildingId: bid, locationId: top.id, activityKey: a.key };
        p.tasks.push(t);
        tasks.set(i.id, t);
        return;
      }
      const cfg = configOf(d, i), dur = durationOf(cfg, i.milestone) as { ok: true; days: number };
      const q = numberOrBlank(cfg.quantity), r = numberOrBlank(cfg.productivity);
      const zoneName = i.zoneId ? d.locations.find(l => l.id === i.zoneId)!.name.trim() : '';
      const crew = i.milestone ? undefined : crewUid(cfg.crew);
      const t = M.newTask(p, {
        name: a.name.trim() + (zoneName ? ' — ' + zoneName : ''), level: i.parentId ? 4 : 3, duration: dur.days, milestone: i.milestone,
        notes: cfg.notes.trim(), assignments: crew ? [{ res: crew, units: 100 }] : []
      });
      const meta: TaskConstruction = {
        instanceId: i.id, role: 'activity', buildingId: bid, locationId: i.locationId, activityKey: a.key,
        quantity: i.milestone || q == null || isNaN(q) ? null : q, unit: i.milestone ? '' : (isUnit(cfg.unit) ? cfg.unit : ''),
        durationMode: i.milestone ? 'manual' : cfg.mode, productivity: i.milestone || r == null || isNaN(r) ? null : r,
        engineer: i.milestone ? null : person(cfg.engineerId), dependencyReview: review.has(i.id) ? 'needs-review' : 'proposed'
      };
      const con = i.milestone ? undefined : contractorId(cfg.contractor);
      if (con) meta.contractorId = con;
      if (crew) meta.crewResourceUid = crew;
      if (reasons.has(i.id)) meta.proposedLinks = reasons.get(i.id);
      t.construction = meta;
      p.tasks.push(t);
      tasks.set(i.id, t);
    });
  });

  links.forEach(l => {
    const a = tasks.get(l.from), b = tasks.get(l.to);
    if (a && b) b.preds.push({ uid: a.uid, type: l.type, lag: l.lag });
  });

  const used = new Set(insts.map(i => i.key));
  const construction: ProjectConstruction = {
    schema: 1,
    template: { key: CATALOGUE_KEY, version: CATALOGUE_VERSION },
    buildings: [{ id: bid, name: d.building.name.trim(), engineer: person(d.engineerId) }],
    locations: d.locations.map(l => ({ ...l, name: l.name.trim(), code: l.code.trim() })),
    contractors,
    activities: d.activities.filter(a => used.has(a.key)).map(a => ({ key: a.key, name: a.name.trim(), group: a.group, unit: a.unit, milestone: a.milestone, custom: a.custom })),
    review: { state: 'draft', generatedAt: ctx.now, generatedBy: ctx.generatedBy, note: REVIEW_NOTE }
  };
  p.construction = construction;
  const out: Project = M.normalize(p);
  const loop = OP.schedule(out, { cycleOnly: true }).cycle as number[];
  if (loop.length) return { ok: false, errors: ['The dependencies form a loop (rows ' + loop.join(', ') + ').'] };
  return { ok: true, project: out };
}

/* ---------- submitting once ---------- */

// Wraps the save so repeated clicks share one request; after a failure the next call tries again.
// The draft's requestId goes with every attempt, so the server returns the same plan if an earlier attempt did land.
export function createSubmitter<T>(send: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    if (!inflight) inflight = send().catch(e => { inflight = null; throw e; });
    return inflight;
  };
}

/* ---------- custom activities ---------- */

export function addCustomActivity(d: PlanDraft, name: string, group: GroupKey, unit: CxUnit | '', milestone: boolean): PlanDraft {
  let n = 1;
  while (d.activities.some(a => a.key === 'custom-' + n)) n++;
  const a: PlanActivity = {
    key: 'custom-' + n, name: name.trim(), group, unit: milestone ? '' : unit, milestone, custom: true, scope: 'floors', enabled: true,
    locationIds: defaultLocationIds('floors', d.locations), splits: {}
  };
  return { ...d, activities: d.activities.concat([a]) };
}
