import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import OP from '../core';
import { S } from '../store';
import { currentUser } from '../auth';
import { api, type DirectoryUser } from '../lib/api';
import { createProject } from '../lib/actions';
import Icon from './Icon';
import type { CalException, CxLocation, CxUnit, LinkType } from '../types';
import { GROUPS, UNITS, unitLabel, type GroupKey } from '../lib/construction/catalogue';
import {
  LOCATION_TYPES, MAX_LEVELS, addCustomActivity, addLinkProblem, addTopLocation, addZone, configOf, createSubmitter, durationOf,
  finalLinks, generatePlan, instanceLabel, instancesOf, levelCounts, linkProblems, locationName, locationProblems, needsReview, newDraft,
  patchConfigs, planIssues, quantityTotals, reconcileLocations, removeLocation, syncLevels, topLocations, zonesOf,
  type Instance, type InstanceConfig, type Issue, type PlanActivity, type PlanDraft, type PlanLink
} from '../lib/construction/plan';

/*
 * "Create building plan": a five-step setup that ends in an ordinary draft project opened in the editor.
 * All rules live in lib/construction/plan.ts; this file only collects input and shows what will be generated.
 */

const U = OP.util;
const STEPS = ['Project and building', 'Locations', 'Activities', 'Quantities and durations', 'Review and generate'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNIT_KEYS = Object.keys(UNITS) as CxUnit[];

type SetDraft = (fn: (d: PlanDraft) => PlanDraft) => void;
interface StepProps { d: PlanDraft; set: SetDraft; insts: Instance[]; users: DirectoryUser[]; showReq: boolean }

const Err = ({ msg }: { msg?: string }) => (msg ? <span className="cx-err" role="alert">{msg}</span> : null);

function UnitSelect({ value, onChange, label, allowNone }: { value: CxUnit | ''; onChange: (u: CxUnit | '') => void; label: string; allowNone?: boolean }) {
  return (
    <select className="sel" aria-label={label} value={value} onChange={e => onChange(e.target.value as CxUnit | '')}>
      {allowNone && <option value="">—</option>}
      {!allowNone && !value && <option value="">Choose…</option>}
      {(['area', 'volume', 'length', 'count'] as const).map(dim => (
        <optgroup key={dim} label={dim[0].toUpperCase() + dim.slice(1)}>
          {UNIT_KEYS.filter(u => UNITS[u].dim === dim).map(u => <option key={u} value={u}>{UNITS[u].label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function EngineerSelect({ users, value, onChange, label }: { users: DirectoryUser[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <select className="sel" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Unassigned</option>
      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      {value && !users.some(u => u.id === value) && <option value={value}>(user not available)</option>}
    </select>
  );
}

/* ---------- step A: project and building ---------- */

function CalendarPreview({ start, workDays, exceptions }: { start: string; workDays: number[]; exceptions: CalException[] }) {
  const s = U.parseDate(start);
  if (s == null || !workDays.length) return <p className="muted small">Choose the start date and working days to preview the site calendar.</p>;
  const cal = new OP.Calendar(s, [], workDays, exceptions.filter(x => U.parseDate(x.from) != null));
  const days = Array.from({ length: 28 }, (_, k) => s + k);
  const named = (dn: number) => {
    const x = exceptions.filter(e => { const a = U.parseDate(e.from), b = U.parseDate(e.to || e.from); return a != null && b != null && dn >= Math.min(a, b) && dn <= Math.max(a, b); }).pop();
    return x ? x.name || (x.working ? 'Working time' : 'Non-working time') : '';
  };
  const count = days.filter(dn => cal.isWorking(dn)).length;
  return (
    <div className="cx-cal">
      <p className="small">First working day: <b>{U.fmtLong(cal.first)}</b> · {count} working days in the first four weeks.</p>
      <div className="cx-cal-grid" role="list" aria-label="First four weeks of the site calendar">
        {days.map(dn => {
          const w = cal.isWorking(dn), ex = named(dn);
          return (
            <span key={dn} role="listitem" className={'cx-day' + (w ? ' on' : '') + (ex ? ' ex' : '')} title={U.fmtLong(dn) + (w ? ' — working' : ' — not working') + (ex ? ' (' + ex + ')' : '')}>
              <small>{DAYS[U.weekday(dn)][0]}</small>{U.toDate(dn).getUTCDate()}
            </span>
          );
        })}
      </div>
      <p className="muted small">Filled days are working days. Outlined days have a calendar exception.</p>
    </div>
  );
}

function ProjectStep({ d, set, users, showReq }: StepProps) {
  const ex = d.exceptions;
  const patchEx = (k: number, v: Partial<CalException>) => set(x => ({ ...x, exceptions: x.exceptions.map((e, i) => (i === k ? { ...e, ...v } : e)) }));
  return (
    <>
      <div className="row2">
        <label className="field"><span>Project name *</span>
          <input className="inp" value={d.name} placeholder="e.g. Neoteric Heights" onChange={e => set(x => ({ ...x, name: e.target.value }))} aria-invalid={showReq && !d.name.trim()} />
          {showReq && !d.name.trim() && <Err msg="Enter a project name" />}
        </label>
        <label className="field"><span>Building / tower name *</span>
          <input className="inp" value={d.building.name} onChange={e => set(x => ({ ...x, building: { ...x.building, name: e.target.value } }))} aria-invalid={!d.building.name.trim()} />
          {!d.building.name.trim() && <Err msg="Enter the building name" />}
        </label>
      </div>
      <div className="row2">
        <label className="field"><span>Project start date *</span>
          <input className="inp" type="date" value={d.start} onChange={e => set(x => ({ ...x, start: e.target.value }))} aria-invalid={U.parseDate(d.start) == null} />
          {U.parseDate(d.start) == null && <Err msg="Enter a valid date" />}
        </label>
        <label className="field"><span>Project engineer (optional)</span>
          <EngineerSelect users={users} value={d.engineerId} onChange={v => set(x => ({ ...x, engineerId: v }))} label="Project engineer" />
        </label>
      </div>
      <p className="muted small">One building per run. Add further buildings as separate plans for now.</p>

      <fieldset className="cx-box">
        <legend>Site working calendar *</legend>
        <div className="cx-days">
          {DAYS.map((name, i) => (
            <label key={i} className="chk"><input type="checkbox" checked={d.workDays.includes(i)}
              onChange={e => set(x => ({ ...x, workDays: e.target.checked ? x.workDays.concat([i]).sort() : x.workDays.filter(w => w !== i) }))} />{name}</label>
          ))}
          <span className="cx-quick">
            <button type="button" className="btn ghost" onClick={() => set(x => ({ ...x, workDays: [1, 2, 3, 4, 5, 6] }))}>Mon–Sat</button>
            <button type="button" className="btn ghost" onClick={() => set(x => ({ ...x, workDays: [1, 2, 3, 4, 5] }))}>Mon–Fri</button>
          </span>
        </div>
        {showReq && !d.workDays.length && <Err msg="Choose the days the site works. Nothing is assumed." />}
        <div className="field"><span>Holidays and other exceptions</span>
          <div className="mini-list">
            {ex.map((x, k) => (
              <div className="mini-row exc" key={k}>
                <input className="inp" aria-label="Exception name" placeholder="e.g. Diwali" value={x.name} onChange={e => patchEx(k, { name: e.target.value })} />
                <input className="inp" type="date" aria-label="From" value={x.from} onChange={e => patchEx(k, { from: e.target.value, to: x.to && x.to >= e.target.value ? x.to : e.target.value })} />
                <input className="inp" type="date" aria-label="To" value={x.to} onChange={e => patchEx(k, { to: e.target.value })} />
                <select className="sel" aria-label="Working or not" value={x.working ? '1' : '0'} onChange={e => patchEx(k, { working: e.target.value === '1' })}>
                  <option value="0">Not working</option><option value="1">Working</option>
                </select>
                <button type="button" className="icon-btn" aria-label="Remove exception" onClick={() => set(y => ({ ...y, exceptions: y.exceptions.filter((_, i) => i !== k) }))}><Icon name="x" /></button>
              </div>
            ))}
            <button type="button" className="btn ghost" onClick={() => set(y => ({ ...y, exceptions: y.exceptions.concat([{ name: '', from: y.start, to: y.start, working: false }]) }))}><Icon name="plus" />Add exception</button>
          </div>
        </div>
        <CalendarPreview start={d.start} workDays={d.workDays} exceptions={d.exceptions} />
        <p className="muted small">This becomes the project calendar used for every activity; you can change it later under Project › Change Working Time. The scheduler has one calendar per project, so activities cannot have their own.</p>
      </fieldset>
    </>
  );
}

/* ---------- step B: locations ---------- */

function LocationsStep({ d, set }: StepProps) {
  const counts = levelCounts(d.locations);
  const probs = useMemo(() => locationProblems(d.locations), [d.locations]);
  const [zoneText, setZoneText] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('');
  const setLocs = (fn: (l: CxLocation[]) => CxLocation[]) => set(x => reconcileLocations(x, fn(x.locations)));
  const setCounts = (c: Partial<typeof counts>) => setLocs(l => syncLevels(l, { ...counts, ...c }, d.building.id));
  const patch = (id: string, v: Partial<CxLocation>) => set(x => ({ ...x, locations: x.locations.map(l => (l.id === id ? { ...l, ...v } : l)) }));
  const addZones = (parent: string) => {
    const names = (zoneText[parent] || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    if (!names.length) return;
    setLocs(l => names.reduce((acc, n) => addZone(acc, parent, n), l));
    setZoneText(z => ({ ...z, [parent]: '' }));
  };
  const num = (v: string) => Math.max(0, Math.min(MAX_LEVELS, Math.floor(+v || 0)));
  const row = (l: CxLocation, zone = false) => (
    <div className={'cx-loc' + (zone ? ' zone' : '')} key={l.id}>
      <span className="cx-type">{LOCATION_TYPES[l.type]}</span>
      <label className="field"><span>Code</span><input className="inp" value={l.code} aria-invalid={!!probs[l.id]?.code} onChange={e => patch(l.id, { code: e.target.value })} /><Err msg={probs[l.id]?.code} /></label>
      <label className="field"><span>Name</span><input className="inp" value={l.name} aria-invalid={!!probs[l.id]?.name} onChange={e => patch(l.id, { name: e.target.value })} /><Err msg={probs[l.id]?.name} /></label>
      {(zone || l.type === 'common' || l.type === 'building_works')
        ? <button type="button" className="icon-btn" aria-label={'Remove ' + l.name} title="Remove" onClick={() => setLocs(x => removeLocation(x, l.id))}><Icon name="trash" /></button>
        : <span />}
    </div>
  );
  return (
    <>
      <div className="cx-counts">
        <label className="field"><span>Basement levels</span><input className="inp" type="number" min={0} max={MAX_LEVELS} value={counts.basements} onChange={e => setCounts({ basements: num(e.target.value) })} /></label>
        <label className="chk"><input type="checkbox" checked={counts.ground} onChange={e => setCounts({ ground: e.target.checked })} />Ground floor</label>
        <label className="field"><span>Numbered floors above ground</span><input className="inp" type="number" min={0} max={MAX_LEVELS} value={counts.floors} onChange={e => setCounts({ floors: num(e.target.value) })} /></label>
        <label className="chk"><input type="checkbox" checked={counts.terrace} onChange={e => setCounts({ terrace: e.target.checked })} />Terrace</label>
      </div>
      <p className="muted small">Names and codes are suggestions you can edit. Each location keeps a fixed internal id, so renaming never breaks links. Codes must be unique within their parent.</p>
      <div className="cx-locs">
        {topLocations(d.locations).map(l => (
          <div key={l.id} className="cx-loc-group">
            {row(l)}
            {zonesOf(d.locations, l.id).map(z => row(z, true))}
            {['basement', 'ground', 'floor', 'terrace'].includes(l.type) && (
              <div className="cx-zone-add">
                <input className="inp" placeholder="Flats or zones on this floor (optional), e.g. Flat 101, Flat 102" aria-label={'Add flats or zones to ' + l.name}
                  value={zoneText[l.id] || ''} onChange={e => setZoneText(z => ({ ...z, [l.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addZones(l.id); } }} />
                <button type="button" className="btn" onClick={() => addZones(l.id)}><Icon name="plus" />Add</button>
              </div>
            )}
          </div>
        ))}
        {!topLocations(d.locations).length && <Err msg="Add at least one floor or building-level location." />}
      </div>
      <div className="cx-zone-add">
        <input className="inp" placeholder="e.g. Clubhouse, Façade and external works" aria-label="New location name" value={extra} onChange={e => setExtra(e.target.value)} />
        <button type="button" className="btn" disabled={!extra.trim()} onClick={() => { setLocs(l => addTopLocation(l, 'common', extra.trim(), d.building.id)); setExtra(''); }}><Icon name="plus" />Common area</button>
        <button type="button" className="btn" disabled={!extra.trim()} onClick={() => { setLocs(l => addTopLocation(l, 'building_works', extra.trim(), d.building.id)); setExtra(''); }}><Icon name="plus" />Building-level works</button>
      </div>
      <p className="muted small">Building-level works (such as the façade) hold activities done once for the whole building, so they are not repeated under every floor. Flats or zones are optional; by default every activity is planned once per floor, and you choose which activities to split by zone in the next step.</p>
    </>
  );
}

/* ---------- step C: activities ---------- */

function ActivitiesStep({ d, set, insts }: StepProps) {
  const tops = topLocations(d.locations);
  const [custom, setCustom] = useState({ name: '', group: 'finishes' as GroupKey, unit: 'sqft' as CxUnit | '', milestone: false });
  const patchAct = (key: string, v: Partial<PlanActivity>) => set(x => ({ ...x, activities: x.activities.map(a => (a.key === key ? { ...a, ...v } : a)) }));
  const move = (key: string, dir: -1 | 1) => set(x => {
    const list = x.activities.slice(), i = list.findIndex(a => a.key === key), g = list[i].group;
    let j = i + dir;
    while (j >= 0 && j < list.length && list[j].group !== g) j += dir;
    if (j < 0 || j >= list.length) return x;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...x, activities: list };
  });
  const toggleLoc = (a: PlanActivity, id: string, on: boolean) => patchAct(a.key, { locationIds: tops.map(t => t.id).filter(t => (t === id ? on : a.locationIds.includes(t))) });
  const withZones = tops.filter(t => zonesOf(d.locations, t.id).length);
  return (
    <>
      <p className="alert info inline"><Icon name="info" />This catalogue is a planning starter, not a construction method. Durations, dependencies, release conditions and any further prerequisites need review by the project engineer. Display order is only the order rows appear in; it never creates dependencies.</p>
      <div className="cx-scroll">
        <table className="data cx-acts">
          <thead><tr>
            <th>Use</th><th>Activity (name in this plan)</th><th>Default unit</th>
            {tops.map(t => <th key={t.id} className="cx-loc-h" title={t.name}>{t.code}</th>)}
            <th>Order</th>
          </tr></thead>
          {GROUPS.map(g => {
            const list = d.activities.filter(a => a.group === g.key);
            if (!list.length) return null;
            return (
              <tbody key={g.key}>
                <tr className="cx-group"><td colSpan={4 + tops.length}>{g.name}</td></tr>
                {list.map(a => (
                  <tr key={a.key} className={a.enabled ? '' : 'off'}>
                    <td><input type="checkbox" aria-label={'Use ' + a.name} checked={a.enabled} onChange={e => patchAct(a.key, { enabled: e.target.checked })} /></td>
                    <td>
                      <input className="inp" aria-label={'Name for ' + a.key} value={a.name} onChange={e => patchAct(a.key, { name: e.target.value })} />
                      {a.enabled && !a.name.trim() && <Err msg="Enter a name" />}
                      {a.milestone && <span className="cx-tag">Milestone</span>}{a.custom && <span className="cx-tag">Custom</span>}
                    </td>
                    <td>{a.milestone ? <span className="muted small">—</span> : <UnitSelect value={a.unit} label={'Default unit for ' + a.name} allowNone onChange={u => patchAct(a.key, { unit: u })} />}</td>
                    {a.scope === 'auto'
                      ? <td colSpan={tops.length} className="muted small">Added wherever concealed services are selected, and linked to them. A scheduled date here is not proof that an inspection passed.</td>
                      : tops.map(t => (
                        <td key={t.id} className="cx-cell">
                          <input type="checkbox" aria-label={a.name + ' on ' + t.name} checked={a.locationIds.includes(t.id)} disabled={!a.enabled} onChange={e => toggleLoc(a, t.id, e.target.checked)} />
                        </td>
                      ))}
                    <td className="cx-order">
                      <button type="button" className="icon-btn" aria-label={'Move ' + a.name + ' up'} onClick={() => move(a.key, -1)}><Icon name="up" /></button>
                      <button type="button" className="icon-btn" aria-label={'Move ' + a.name + ' down'} onClick={() => move(a.key, 1)}><Icon name="down" /></button>
                    </td>
                  </tr>
                ))}
                {list.filter(a => a.enabled && a.scope !== 'auto' && !a.locationIds.length).map(a => (
                  <tr key={a.key + '-err'}><td /><td colSpan={3 + tops.length}><Err msg={a.name + ': choose at least one location, or untick it.'} /></td></tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>

      <fieldset className="cx-box">
        <legend>Add a custom activity</legend>
        <div className="cx-custom">
          <input className="inp" aria-label="Custom activity name" placeholder="Activity name" value={custom.name} onChange={e => setCustom({ ...custom, name: e.target.value })} />
          <select className="sel" aria-label="Group" value={custom.group} onChange={e => setCustom({ ...custom, group: e.target.value as GroupKey })}>
            {GROUPS.map(g => <option key={g.key} value={g.key}>{g.name}</option>)}
          </select>
          <UnitSelect value={custom.milestone ? '' : custom.unit} label="Unit" allowNone onChange={u => setCustom({ ...custom, unit: u })} />
          <label className="chk"><input type="checkbox" checked={custom.milestone} onChange={e => setCustom({ ...custom, milestone: e.target.checked })} />Milestone</label>
          <button type="button" className="btn" disabled={!custom.name.trim()} onClick={() => { set(x => addCustomActivity(x, custom.name, custom.group, custom.unit, custom.milestone)); setCustom({ ...custom, name: '' }); }}><Icon name="plus" />Add</button>
        </div>
        <p className="muted small">Custom activities get no proposed dependencies; link them in the review step.</p>
      </fieldset>

      {withZones.length > 0 && (
        <fieldset className="cx-box">
          <legend>Split by flat or zone (optional)</legend>
          <p className="muted small">Unticked: one activity covers the whole floor. Ticked zones: one activity per zone instead, and the floor gets a summary over them. Quantities then belong to the zones only, so nothing is counted twice.</p>
          {withZones.map(t => {
            const zones = zonesOf(d.locations, t.id);
            const acts = d.activities.filter(a => a.enabled && !a.milestone && a.scope !== 'auto' && a.locationIds.includes(t.id));
            return (
              <details key={t.id} className="cx-split" open={withZones.length <= 2}>
                <summary>{t.name} <span className="muted small">· {zones.length} zone{zones.length > 1 ? 's' : ''} · {acts.filter(a => (a.splits[t.id] || []).length).length} split activit{acts.filter(a => (a.splits[t.id] || []).length).length === 1 ? 'y' : 'ies'}</span></summary>
                <div className="cx-scroll">
                  <table className="data">
                    <thead><tr><th>Activity</th>{zones.map(z => <th key={z.id} className="cx-loc-h" title={z.name}>{z.code}</th>)}<th>Planned as</th></tr></thead>
                    <tbody>{acts.map(a => {
                      const chosen = a.splits[t.id] || [];
                      const setZ = (ids: string[]) => patchAct(a.key, { splits: { ...a.splits, [t.id]: ids } });
                      return (
                        <tr key={a.key}>
                          <td>{a.name}</td>
                          {zones.map(z => (
                            <td key={z.id} className="cx-cell"><input type="checkbox" aria-label={'Split ' + a.name + ' into ' + z.name} checked={chosen.includes(z.id)}
                              onChange={e => setZ(zones.map(x => x.id).filter(id => (id === z.id ? e.target.checked : chosen.includes(id))))} /></td>
                          ))}
                          <td className="small">{chosen.length ? chosen.length + ' zone activit' + (chosen.length === 1 ? 'y' : 'ies') + (chosen.length < zones.length ? ' (not all zones)' : '') : 'One floor activity'}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </fieldset>
      )}
      <p className="muted small">{insts.filter(i => i.executable).length} activities will be generated.</p>
    </>
  );
}

/* ---------- step D: quantities and durations ---------- */

type BulkKey = 'mode' | 'quantity' | 'unit' | 'productivity' | 'duration' | 'contractor' | 'crew' | 'engineerId';
const BULK_LABELS: Record<BulkKey, string> = {
  mode: 'Duration mode', quantity: 'Quantity', unit: 'Unit', productivity: 'Output per crew day', duration: 'Duration', contractor: 'Contractor', crew: 'Crew', engineerId: 'Responsible engineer'
};

function scopeText(d: PlanDraft, list: Instance[]) {
  const byAct = new Map<string, string[]>();
  list.forEach(i => byAct.set(i.key, (byAct.get(i.key) || []).concat([locationName(d.locations, i.locationId)])));
  const parts = Array.from(byAct, ([k, locs]) => (d.activities.find(a => a.key === k)?.name || k) + ' on ' + locs.join(', '));
  return parts.slice(0, 6).join('; ') + (parts.length > 6 ? '; and ' + (parts.length - 6) + ' more activity types' : '');
}

function ConfigureStep({ d, set, insts, users, showReq }: StepProps) {
  const rows = insts.filter(i => i.executable);
  const [locF, setLocF] = useState(''), [actF, setActF] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<InstanceConfig>({ mode: 'quantity', quantity: '', unit: '', productivity: '', duration: '', contractor: '', crew: '', engineerId: '', notes: '' });
  const [use, setUse] = useState<Set<BulkKey>>(new Set());
  const shown = rows.filter(i => (!locF || i.topId === locF) && (!actF || i.key === actF));
  const selected = rows.filter(i => sel.has(i.id));
  const contractors = Array.from(new Set(Object.values(d.config).map(c => c.contractor.trim()).filter(Boolean)));
  const crews = Array.from(new Set(Object.values(d.config).map(c => c.crew.trim()).filter(Boolean)));
  const patch = (i: Instance, v: Partial<InstanceConfig>) => set(x => patchConfigs(x, [i], v));
  const setUseKey = (k: BulkKey, on: boolean) => setUse(s => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
  const bulkPatch = () => { const v: Partial<InstanceConfig> = {}; use.forEach(k => { (v as any)[k] = bulk[k]; }); return v; };
  const applicable = selected.filter(i => !i.milestone);

  return (
    <>
      <div className="cx-filters">
        <label className="field"><span>Location</span><select className="sel" value={locF} onChange={e => setLocF(e.target.value)}>
          <option value="">All locations</option>{topLocations(d.locations).filter(t => rows.some(i => i.topId === t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
        <label className="field"><span>Activity</span><select className="sel" value={actF} onChange={e => setActF(e.target.value)}>
          <option value="">All activities</option>{d.activities.filter(a => rows.some(i => i.key === a.key)).map(a => <option key={a.key} value={a.key}>{a.name}</option>)}
        </select></label>
        <span className="cx-quick">
          <button type="button" className="btn" onClick={() => setSel(s => new Set([...s, ...shown.filter(i => !i.milestone).map(i => i.id)]))}>Select shown ({shown.filter(i => !i.milestone).length})</button>
          <button type="button" className="btn ghost" disabled={!sel.size} onClick={() => setSel(new Set())}>Clear selection</button>
        </span>
      </div>
      <p className="muted small">Quantity-based: duration = quantity ÷ output per crew working day, on the site calendar, rounded to 0.01 day (the scheduler's precision). Crew count does not multiply output. Manual: you enter the duration, and quantity and output are kept for information. Contractor, crew and engineer are optional.</p>
      <div className="cx-scroll cx-config">
        <table className="data">
          <thead><tr>
            <th aria-label="Select" /><th>Activity</th><th>Location</th><th>Mode</th><th className="num">Quantity</th><th>Unit</th><th className="num">Output / crew day</th>
            <th className="num">Duration (working days)</th><th>Contractor</th><th>Crew</th><th>Responsible engineer</th><th>Notes</th>
          </tr></thead>
          <tbody>{shown.map(i => {
            const c = configOf(d, i), r = durationOf(c, i.milestone), e = r.ok ? {} : r.errors;
            const req = showReq || !!d.config[i.id];
            const name = d.activities.find(a => a.key === i.key)?.name || i.key;
            const bad = (k: keyof typeof e) => (req && e[k] ? 'inp bad' : 'inp');
            if (i.milestone) return (
              <tr key={i.id} className="cx-ms">
                <td /><td>{name}</td><td>{locationName(d.locations, i.locationId)}</td>
                <td colSpan={5} className="muted small">Milestone · zero duration</td>
                <td colSpan={3} /><td><input className="inp" aria-label={'Notes for ' + name} value={c.notes} onChange={ev => patch(i, { notes: ev.target.value })} /></td>
              </tr>
            );
            return (
              <tr key={i.id} className={sel.has(i.id) ? 'sel' : ''}>
                <td><input type="checkbox" aria-label={'Select ' + instanceLabel(d, i)} checked={sel.has(i.id)} onChange={ev => setSel(s => { const n = new Set(s); if (ev.target.checked) n.add(i.id); else n.delete(i.id); return n; })} /></td>
                <td>{name}</td>
                <td>{locationName(d.locations, i.locationId)}</td>
                <td><select className="sel" aria-label={'Duration mode for ' + instanceLabel(d, i)} value={c.mode} onChange={ev => patch(i, { mode: ev.target.value as InstanceConfig['mode'] })}>
                  <option value="quantity">Quantity-based</option><option value="manual">Manual</option></select></td>
                <td><input className={bad('quantity')} inputMode="decimal" aria-label={'Quantity for ' + instanceLabel(d, i)} value={c.quantity} onChange={ev => patch(i, { quantity: ev.target.value })} title={req ? e.quantity : undefined} />{req && <Err msg={e.quantity} />}</td>
                <td><UnitSelect value={c.unit} label={'Unit for ' + instanceLabel(d, i)} allowNone={c.mode === 'manual'} onChange={u => patch(i, { unit: u })} />{req && <Err msg={e.unit} />}</td>
                <td><input className={bad('productivity')} inputMode="decimal" aria-label={'Output per crew working day for ' + instanceLabel(d, i)} value={c.productivity} onChange={ev => patch(i, { productivity: ev.target.value })} />{req && <Err msg={e.productivity} />}</td>
                <td className="num">
                  {c.mode === 'manual'
                    ? <><input className={bad('duration')} aria-label={'Duration for ' + instanceLabel(d, i)} value={c.duration} placeholder="days" onChange={ev => patch(i, { duration: ev.target.value })} />{req && <Err msg={e.duration} />}</>
                    : r.ok ? <span className="cx-calc" title={r.calc}><b>{U.num(r.days, 2)}</b><small>{r.calc.split(' → ')[0].replace(' per crew working day', '/day')}</small></span>
                      : <span className="muted small">needs quantity and output</span>}
                </td>
                <td><input className="inp" list="cx-contractors" aria-label={'Contractor for ' + instanceLabel(d, i)} value={c.contractor} onChange={ev => patch(i, { contractor: ev.target.value })} /></td>
                <td><input className="inp" list="cx-crews" aria-label={'Crew for ' + instanceLabel(d, i)} value={c.crew} onChange={ev => patch(i, { crew: ev.target.value })} /></td>
                <td><EngineerSelect users={users} value={c.engineerId} label={'Responsible engineer for ' + instanceLabel(d, i)} onChange={v => patch(i, { engineerId: v })} /></td>
                <td><input className="inp" aria-label={'Notes for ' + instanceLabel(d, i)} value={c.notes} onChange={ev => patch(i, { notes: ev.target.value })} /></td>
              </tr>
            );
          })}</tbody>
        </table>
        <datalist id="cx-contractors">{contractors.map(c => <option key={c} value={c} />)}</datalist>
        <datalist id="cx-crews">{crews.map(c => <option key={c} value={c} />)}</datalist>
      </div>

      <fieldset className="cx-box">
        <legend>Apply these assumptions to selected activities</legend>
        <p className="muted small">Tick the values to copy. Each activity gets its own copy, so editing one floor later never changes another.</p>
        <div className="cx-bulk">
          {(Object.keys(BULK_LABELS) as BulkKey[]).map(k => (
            <div key={k} className="cx-bulk-f">
              <label className="chk"><input type="checkbox" checked={use.has(k)} onChange={ev => setUseKey(k, ev.target.checked)} />{BULK_LABELS[k]}</label>
              {k === 'mode' ? <select className="sel" aria-label="Bulk duration mode" value={bulk.mode} onChange={ev => { setBulk({ ...bulk, mode: ev.target.value as InstanceConfig['mode'] }); setUseKey(k, true); }}><option value="quantity">Quantity-based</option><option value="manual">Manual</option></select>
                : k === 'unit' ? <UnitSelect value={bulk.unit} label="Bulk unit" allowNone onChange={u => { setBulk({ ...bulk, unit: u }); setUseKey(k, true); }} />
                  : k === 'engineerId' ? <EngineerSelect users={users} value={bulk.engineerId} label="Bulk responsible engineer" onChange={v => { setBulk({ ...bulk, engineerId: v }); setUseKey(k, true); }} />
                    : <input className="inp" aria-label={'Bulk ' + BULK_LABELS[k]} list={k === 'contractor' ? 'cx-contractors' : k === 'crew' ? 'cx-crews' : undefined}
                      value={bulk[k]} onChange={ev => { setBulk({ ...bulk, [k]: ev.target.value }); setUseKey(k, true); }} />}
            </div>
          ))}
        </div>
        <p className="small"><b>Scope:</b> {applicable.length ? applicable.length + ' activit' + (applicable.length === 1 ? 'y' : 'ies') + ' — ' + scopeText(d, applicable) : 'nothing selected. Tick rows above, or filter and use “Select shown”.'}</p>
        <p className="small"><b>Will set:</b> {use.size ? Array.from(use).map(k => BULK_LABELS[k] + ' = ' + (k === 'unit' ? unitLabel(bulk.unit) || '—' : k === 'engineerId' ? users.find(u => u.id === bulk.engineerId)?.name || 'Unassigned' : k === 'mode' ? (bulk.mode === 'manual' ? 'Manual' : 'Quantity-based') : (bulk[k] || '(blank)'))).join(', ') : 'no values ticked.'}</p>
        <button type="button" className="btn primary" disabled={!applicable.length || !use.size} onClick={() => { set(x => patchConfigs(x, applicable, bulkPatch())); S().toast('Applied to ' + applicable.length + ' activit' + (applicable.length === 1 ? 'y' : 'ies')); }}>
          Apply to {applicable.length} activit{applicable.length === 1 ? 'y' : 'ies'}
        </button>
      </fieldset>
    </>
  );
}

/* ---------- step E: review and generate ---------- */

function LinkRow({ d, l, insts, problem, set }: { d: PlanDraft; l: PlanLink; insts: Map<string, Instance>; problem?: string; set: SetDraft }) {
  const label = (id: string) => { const i = insts.get(id); return i ? instanceLabel(d, i) : id + ' (missing)'; };
  const change = (v: { type?: LinkType; lag?: number }) => set(x => {
    if (l.origin === 'added') return { ...x, addedLinks: x.addedLinks.map(a => (a.from === l.from && a.to === l.to ? { ...a, ...v } : a)) };
    return { ...x, changedLinks: { ...x.changedLinks, [l.id]: { type: v.type ?? l.type, lag: v.lag ?? l.lag } } };
  });
  const remove = () => set(x => (l.origin === 'added'
    ? { ...x, addedLinks: x.addedLinks.filter(a => !(a.from === l.from && a.to === l.to)) }
    : { ...x, removedLinks: x.removedLinks.concat([l.id]) }));
  return (
    <tr className={problem ? 'bad' : ''}>
      <td>{label(l.from)}</td><td>{label(l.to)}</td>
      <td><select className="sel" aria-label="Link type" value={l.type} onChange={e => change({ type: e.target.value as LinkType })}>
        {OP.model.LINK_TYPES.map((t: string) => <option key={t}>{t}</option>)}</select></td>
      <td><input className="inp" type="number" step={0.5} aria-label="Lag in working days" value={l.lag} onChange={e => change({ lag: +e.target.value || 0 })} /></td>
      <td className="small">{l.reason}{l.mapping && <> <i>{l.mapping}</i></>}{problem && <Err msg={problem} />}</td>
      <td><span className={'cx-tag' + (l.origin === 'added' ? ' added' : '')}>{l.origin === 'added' ? 'Added' : 'Proposed — review'}{l.edited ? ' · edited' : ''}</span></td>
      <td><button type="button" className="icon-btn" aria-label={'Remove link ' + label(l.from) + ' to ' + label(l.to)} onClick={remove}><Icon name="trash" /></button></td>
    </tr>
  );
}

function ReviewStep({ d, set, insts, links, droppedAdded, issues, goTo }: StepProps & { links: PlanLink[]; droppedAdded: number; issues: Issue[]; goTo: (s: number) => void }) {
  const byId = useMemo(() => new Map(insts.map(i => [i.id, i])), [insts]);
  const problems = useMemo(() => linkProblems(d, insts, links), [d, insts, links]);
  const review = needsReview(insts, links);
  const [locF, setLocF] = useState('');
  const [add, setAdd] = useState({ from: '', to: '', type: 'FS' as LinkType, lag: 0 });
  const exec = insts.filter(i => i.executable);
  const tops = topLocations(d.locations).filter(t => exec.some(i => i.topId === t.id));
  const shownLinks = links.filter(l => !locF || byId.get(l.from)?.topId === locF || byId.get(l.to)?.topId === locF);
  const addErr = add.from || add.to ? addLinkProblem(insts, links, add.from, add.to) : '';
  const totals = quantityTotals(d, insts);
  const reviewByAct = new Map<string, string[]>();
  exec.filter(i => review.has(i.id)).forEach(i => reviewByAct.set(i.key, (reviewByAct.get(i.key) || []).concat([locationName(d.locations, i.locationId)])));
  const options = (
    <>{tops.map(t => (
      <optgroup key={t.id} label={t.name}>
        {exec.filter(i => i.topId === t.id).map(i => <option key={i.id} value={i.id}>{instanceLabel(d, i)}</option>)}
      </optgroup>
    ))}</>
  );
  const errors = issues.filter(i => i.level === 'error'), warnings = issues.filter(i => i.level === 'warning'), optional = issues.filter(i => i.level === 'optional');
  const issueList = (list: Issue[]) => <ul className="cx-issues">{list.map((x, k) => <li key={k}>{x.text} <button type="button" className="link-btn" onClick={() => goTo(x.step)}>{STEPS[x.step]}</button></li>)}</ul>;

  return (
    <>
      <div className="cx-summary">
        <div><b>{d.building.name || '—'}</b><span>building</span></div>
        <div><b>{tops.length}</b><span>locations with work</span></div>
        <div><b>{exec.filter(i => !i.milestone).length}</b><span>activities</span></div>
        <div><b>{exec.filter(i => i.milestone).length}</b><span>milestones</span></div>
        <div><b>{links.length}</b><span>dependency links</span></div>
      </div>

      {errors.length > 0 && <div className="cx-issue-box err"><h3><Icon name="alert" />Needed before generating ({errors.length})</h3>{issueList(errors.slice(0, 40))}{errors.length > 40 && <p className="small">…and {errors.length - 40} more.</p>}</div>}
      {warnings.length > 0 && <div className="cx-issue-box warn"><h3>Check these</h3>{issueList(warnings)}</div>}
      {optional.length > 0 && <div className="cx-issue-box"><h3>Optional — can be assigned later</h3>{issueList(optional)}</div>}
      {droppedAdded > 0 && <p className="alert warn inline">{droppedAdded} link{droppedAdded > 1 ? 's' : ''} you added refer to activities that are no longer selected and will not be generated.</p>}

      <details className="cx-split">
        <summary>Planned quantities <span className="muted small">· per activity and unit; different units are never added together</span></summary>
        <table className="data"><thead><tr><th>Activity</th><th className="num">Total</th><th>Unit</th><th className="num">Activities with a quantity</th></tr></thead>
          <tbody>{d.activities.filter(a => totals.has(a.key)).flatMap(a => Array.from(totals.get(a.key)!, ([u, v]) => (
            <tr key={a.key + u}><td>{a.name}</td><td className="num">{U.num(v.total, 2)}</td><td>{unitLabel(u as CxUnit)}</td><td className="num">{v.count}</td></tr>
          )))}
          {!totals.size && <tr><td colSpan={4} className="muted small">No quantities entered yet.</td></tr>}</tbody>
        </table>
      </details>

      <details className="cx-split">
        <summary>Outline that will be generated</summary>
        <ul className="cx-outline">
          <li><b>{d.building.name}</b>
            <ul>{tops.map(t => (
              <li key={t.id}><b>{t.name}</b>
                <ul>{insts.filter(i => i.topId === t.id && !i.parentId).map(i => (
                  <li key={i.id}>{d.activities.find(a => a.key === i.key)?.name}{i.milestone && <span className="cx-tag">Milestone</span>}
                    {!i.executable && <ul>{insts.filter(z => z.parentId === i.id).map(z => <li key={z.id}>{locationName(d.locations, z.locationId).split(' / ').pop()}</li>)}</ul>}
                  </li>
                ))}</ul>
              </li>
            ))}</ul>
          </li>
        </ul>
      </details>

      <h3 className="cx-h">Dependencies</h3>
      <p className="muted small">These are proposed template relationships within each location, for the project engineer to review. They are not a complete engineering specification, and nothing links one floor to another unless you add it. Electrical conduit, concealed plumbing and AC pipework run in parallel after brickwork.</p>
      {problems[''] && <p className="alert inline"><Icon name="alert" />{problems['']}</p>}
      <div className="cx-filters">
        <label className="field"><span>Show links for</span><select className="sel" value={locF} onChange={e => setLocF(e.target.value)}>
          <option value="">All locations</option>{tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
        {d.removedLinks.length > 0 && <button type="button" className="btn ghost" onClick={() => set(x => ({ ...x, removedLinks: [] }))}>Restore {d.removedLinks.length} removed proposal{d.removedLinks.length > 1 ? 's' : ''}</button>}
      </div>
      <div className="cx-scroll cx-links">
        <table className="data">
          <thead><tr><th>Predecessor</th><th>Successor</th><th>Type</th><th>Lag (d)</th><th>Why</th><th>Status</th><th aria-label="Remove" /></tr></thead>
          <tbody>
            {shownLinks.map(l => <LinkRow key={l.id + l.origin} d={d} l={l} insts={byId} problem={problems[l.id]} set={set} />)}
            {!shownLinks.length && <tr><td colSpan={7} className="muted small">No links.</td></tr>}
          </tbody>
        </table>
      </div>
      <fieldset className="cx-box">
        <legend>Add a link</legend>
        <div className="cx-addlink">
          <select className="sel" aria-label="Predecessor" value={add.from} onChange={e => setAdd({ ...add, from: e.target.value })}><option value="">Predecessor…</option>{options}</select>
          <select className="sel" aria-label="Successor" value={add.to} onChange={e => setAdd({ ...add, to: e.target.value })}><option value="">Successor…</option>{options}</select>
          <select className="sel" aria-label="Link type" value={add.type} onChange={e => setAdd({ ...add, type: e.target.value as LinkType })}>{OP.model.LINK_TYPES.map((t: string) => <option key={t}>{t}</option>)}</select>
          <input className="inp" type="number" step={0.5} aria-label="Lag in working days" value={add.lag} onChange={e => setAdd({ ...add, lag: +e.target.value || 0 })} />
          <button type="button" className="btn" disabled={!add.from || !add.to || !!addErr} onClick={() => { set(x => ({ ...x, addedLinks: x.addedLinks.concat([{ ...add }]) })); setAdd({ ...add, from: '', to: '' }); }}><Icon name="plus" />Add link</button>
        </div>
        {addErr && <Err msg={addErr} />}
        <p className="muted small">Cross-floor links are allowed when you add them here. After generating, the usual predecessor column (e.g. 12FS+2d) and task details work as normal.</p>
      </fieldset>

      {reviewByAct.size > 0 && (
        <div className="cx-issue-box">
          <h3>Needs dependency review</h3>
          <p className="small">These have no proposed predecessor because the template has no safe default for them. They are generated without one and marked “Needs dependency review”.</p>
          <ul className="cx-issues">{Array.from(reviewByAct, ([k, locs]) => <li key={k}><b>{d.activities.find(a => a.key === k)?.name}</b>: {locs.join(', ')}</li>)}</ul>
        </div>
      )}
      <p className="alert info inline"><Icon name="info" />The plan is created as a <b>Draft that requires project engineer review</b>. It is not approved and no baseline is set. Review and edit it in the Gantt chart, then set a baseline when it is agreed.</p>
    </>
  );
}

/* ---------- the wizard ---------- */

export default function ConstructionWizard() {
  const ref = useRef<HTMLDialogElement>(null);
  const [d, setD] = useState<PlanDraft>(() => newDraft(U.iso(U.todayDn())));
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState<Set<number>>(new Set());
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [usersErr, setUsersErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const pristine = useRef(JSON.stringify(d));
  const latest = useRef(d);
  latest.current = d;

  useEffect(() => { if (!ref.current!.open) ref.current!.showModal(); }, []);
  useEffect(() => {
    api<{ users: DirectoryUser[] }>('GET', '/users/directory').then(r => setUsers(r.users), (e: Error) => setUsersErr(e.message));
  }, []);

  const set: SetDraft = fn => { setD(fn); setError(''); };
  const insts = useMemo(() => instancesOf(d), [d]);
  const { links, droppedAdded } = useMemo(() => finalLinks(d, insts), [d, insts]);
  const issues = useMemo(() => planIssues(d, insts, links), [d, insts, links]);
  const errorsAt = (s: number) => issues.filter(i => i.level === 'error' && i.step === s).length;

  const close = () => S().closeDialog();
  const requestClose = () => { if (busy) return; if (JSON.stringify(d) === pristine.current) close(); else setConfirmClose(true); };
  const goTo = (s: number) => { setTried(t => new Set(t).add(step)); setStep(s); setConfirmClose(false); ref.current?.querySelector('.dlg-body')?.scrollTo(0, 0); };

  // One create per wizard: repeated clicks share the request, and the draft's requestId lets the server
  // return the first plan if a retry follows a lost response.
  const submit = useMemo(() => createSubmitter(async () => {
    const st = S();
    if (st.project && st.saveState !== 'ok' && st.saveState !== 'readonly' && !(await st.saveNow())) {
      throw new Error('The project that is open has changes that could not be saved, so nothing was created. Fix or discard them, then generate again.');
    }
    const me = currentUser();
    const res = generatePlan(latest.current, { users, generatedBy: me ? { userId: me.id, name: me.name } : null, now: new Date().toISOString() });
    if (!res.ok) throw new Error('Fix these first: ' + res.errors.slice(0, 3).join(' ') + (res.errors.length > 3 ? ' …' : ''));
    let msg = '';
    const ok = await createProject(res.project, 'Draft building plan created. It needs project engineer review before it is approved or baselined.',
      { requestId: latest.current.requestId, onError: m => { msg = m; } });
    if (!ok) throw new Error(msg + ' Nothing was created; your inputs are kept, so you can try again.');
    return true;
  }), [users]);

  const generate = async () => {
    setTried(new Set([0, 1, 2, 3, 4]));
    if (issues.some(i => i.level === 'error')) { setError('Some required information is missing. See “Needed before generating” below.'); return; }
    setBusy(true);
    setError('');
    try {
      await submit();
      S().setView('gantt');
      close();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const props: StepProps = { d, set, insts, users, showReq: tried.has(step) };
  let body: ReactNode;
  if (step === 0) body = <ProjectStep {...props} />;
  else if (step === 1) body = <LocationsStep {...props} />;
  else if (step === 2) body = <ActivitiesStep {...props} />;
  else if (step === 3) body = <ConfigureStep {...props} />;
  else body = <ReviewStep {...props} links={links} droppedAdded={droppedAdded} issues={issues} goTo={goTo} />;

  return (
    <dialog ref={ref} className="cx-wizard" aria-labelledby="cx-title" onCancel={e => { e.preventDefault(); requestClose(); }}>
      <div className="dlg-head"><h2 id="cx-title">Create building plan</h2><button type="button" className="icon-btn" aria-label="Close" onClick={requestClose}><Icon name="x" /></button></div>
      <ol className="cx-steps">
        {STEPS.map((name, k) => (
          <li key={k}><button type="button" className={k === step ? 'on' : ''} aria-current={k === step ? 'step' : undefined} onClick={() => goTo(k)}>
            <span className="cx-n">{k + 1}</span><span className="cx-sn">{name}</span>
            {tried.has(k) && k !== 4 && errorsAt(k) > 0 && <span className="cx-badge" title={errorsAt(k) + ' to fix'}>{errorsAt(k)}</span>}
          </button></li>
        ))}
      </ol>
      <div className="dlg-body">
        {usersErr && step === 0 && <p className="alert warn inline">Could not load the user list ({usersErr}). You can leave engineers unassigned and set them later.</p>}
        {body}
      </div>
      {confirmClose && (
        <div className="cx-confirm" role="alertdialog" aria-label="Discard this building plan?">
          <span>Discard this building plan setup? Nothing has been created yet.</span>
          <button type="button" className="btn" onClick={() => setConfirmClose(false)}>Keep editing</button>
          <button type="button" className="btn primary" onClick={close}>Discard</button>
        </div>
      )}
      {error && <p className="alert inline cx-foot-err" role="alert"><Icon name="alert" />{error}</p>}
      <div className="dlg-foot">
        <button type="button" className="btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        {step > 0 && <button type="button" className="btn" onClick={() => goTo(step - 1)} disabled={busy}>Back</button>}
        {step < 4 && <button type="button" className="btn primary" onClick={() => goTo(step + 1)}>Next: {STEPS[step + 1]}</button>}
        {step === 4 && <button type="button" className="btn primary" onClick={() => void generate()} disabled={busy} aria-busy={busy}>{busy ? 'Generating…' : 'Generate draft plan'}</button>}
      </div>
    </dialog>
  );
}

