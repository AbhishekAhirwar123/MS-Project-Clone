import { describe, expect, it, vi } from 'vitest';
import OP from '../../core';
import type { Project, Task } from '../../types';
import { CATALOGUE, RELEASE_KEY } from './catalogue';
import {
  addLinkProblem, addZone, blankConfig, createSubmitter, durationOf, finalLinks, floorName, generatePlan, instancesOf, linkProblems,
  locationProblems, newDraft, patchConfigs, planIssues, quantityTotals, reconcileLocations, syncLevels, type PlanDraft
} from './plan';

const U = OP.util;
const CTX = { users: [{ id: 'u1', name: 'Asha Engineer' }], generatedBy: { userId: 'u1', name: 'Asha Engineer' }, now: '2026-11-14T10:00:00.000Z' };

// Two numbered floors, a Monday–Saturday site calendar, and a manual 5-day duration on every activity.
function draft(fn?: (d: PlanDraft) => PlanDraft): PlanDraft {
  let d = newDraft('2026-12-07', 'req-test-1');
  d = reconcileLocations(d, syncLevels(d.locations, { basements: 0, ground: false, floors: 2, terrace: false }, d.building.id));
  d = { ...d, name: 'Neoteric Heights', workDays: [1, 2, 3, 4, 5, 6] };
  if (fn) d = fn(d);
  return patchConfigs(d, instancesOf(d).filter(i => i.executable && !i.milestone && !d.config[i.id]), { mode: 'manual', duration: '5' });
}
function gen(d: PlanDraft): Project {
  const r = generatePlan(d, CTX);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.project;
}
const byInstance = (p: Project, id: string) => p.tasks.find(t => t.construction?.instanceId === id) as Task;
const predIds = (p: Project, t: Task) => t.preds.map(l => p.tasks.find(x => x.uid === l.uid)!.construction!.instanceId);
const toggle = (d: PlanDraft, key: string, enabled: boolean): PlanDraft => ({ ...d, activities: d.activities.map(a => (a.key === key ? { ...a, enabled } : a)) });

describe('locations', () => {
  it('names floors and keeps edits when counts change', () => {
    expect([1, 2, 3, 11, 20, 21, 22, 23].map(floorName)).toEqual(['First floor', 'Second floor', 'Third floor', 'Eleventh floor', 'Twentieth floor', '21st floor', '22nd floor', '23rd floor']);
    let locs = syncLevels([], { basements: 1, ground: true, floors: 2, terrace: true }, 'b');
    expect(locs.map(l => l.name)).toEqual(['Basement 1', 'Ground floor', 'First floor', 'Second floor', 'Terrace']);
    locs = locs.map(l => (l.id === 'loc-F1' ? { ...l, name: 'Podium' } : l));
    locs = syncLevels(locs, { basements: 1, ground: true, floors: 3, terrace: true }, 'b');
    expect(locs.find(l => l.id === 'loc-F1')!.name).toBe('Podium');
    expect(locs.find(l => l.id === 'loc-F3')!.name).toBe('Third floor');
  });

  it('flags duplicate codes and names within the same parent only', () => {
    let locs = syncLevels([], { basements: 0, ground: false, floors: 2, terrace: false }, 'b');
    locs = addZone(addZone(locs, 'loc-F1', 'Flat 101'), 'loc-F2', 'Flat 101');
    expect(locationProblems(locs)).toEqual({}); // the same zone name/code on different floors is fine
    locs = addZone(locs, 'loc-F1', 'flat 101');
    locs = locs.map(l => (l.id === 'loc-F2' ? { ...l, code: 'f1' } : l));
    const probs = locationProblems(locs);
    expect(probs['loc-F1-Z1'].name).toMatch(/Same name/);
    expect(probs['loc-F1-Z2'].name).toMatch(/Same name/);
    expect(probs['loc-F1'].code).toMatch(/Same code/);
    expect(probs['loc-F2'].code).toMatch(/Same code/);
  });

  it('gives newly added floors to activities that were on every floor', () => {
    let d = draft();
    d = reconcileLocations(d, syncLevels(d.locations, { basements: 0, ground: false, floors: 3, terrace: false }, d.building.id));
    expect(d.activities.find(a => a.key === 'brickwork')!.locationIds).toEqual(['loc-F1', 'loc-F2', 'loc-F3']);
  });
});

describe('generating a building plan', () => {
  it('1. creates independent tasks with their own ids and values on each floor', () => {
    const p = gen(draft());
    const f1 = byInstance(p, 'brickwork@loc-F1'), f2 = byInstance(p, 'brickwork@loc-F2');
    expect(f1).toBeTruthy();
    expect(f2).toBeTruthy();
    expect(f1.uid).not.toBe(f2.uid);
    expect(new Set(p.tasks.map(t => t.uid)).size).toBe(p.tasks.length);
    const ids = p.tasks.map(t => t.construction!.instanceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(f1.construction).not.toBe(f2.construction);
    expect(f1.construction!.locationId).toBe('loc-F1');
    expect(f2.construction!.locationId).toBe('loc-F2');
    // Outline: building > floors > activities
    expect(p.tasks[0].construction!.role).toBe('building');
    expect(p.tasks.filter(t => t.construction!.role === 'location').map(t => [t.name, t.level])).toEqual([['First floor', 2], ['Second floor', 2], ['Façade and external works', 2]]);
  });

  it('2. editing Floor 1 does not change Floor 2, the draft or the catalogue', () => {
    const catalogueBefore = JSON.stringify(CATALOGUE);
    let d = draft();
    const insts = instancesOf(d);
    d = patchConfigs(d, insts.filter(i => i.key === 'brickwork'), { mode: 'quantity', quantity: '8000', unit: 'sqft', productivity: '400' });
    d = patchConfigs(d, insts.filter(i => i.id === 'brickwork@loc-F1'), { quantity: '9000' });
    expect(d.config['brickwork@loc-F2'].quantity).toBe('8000');
    expect(d.config['brickwork@loc-F1']).not.toBe(d.config['brickwork@loc-F2']);
    const p = gen(d);
    const f1 = byInstance(p, 'brickwork@loc-F1');
    f1.construction!.quantity = 1;
    f1.duration = 99;
    f1.name = 'Brickwork (revised)';
    const f2 = byInstance(p, 'brickwork@loc-F2');
    expect(f2.construction!.quantity).toBe(8000);
    expect(f2.duration).toBe(20);
    expect(f2.name).toBe('Brickwork');
    expect(d.config['brickwork@loc-F2'].quantity).toBe('8000');
    expect(JSON.stringify(CATALOGUE)).toBe(catalogueBefore);
    expect(Object.isFrozen(CATALOGUE[0])).toBe(true);
  });

  it('3. deselected activities leave no dangling links and nothing is re-routed around them', () => {
    let d = draft(x => toggle(toggle(x, 'brickwork', false), RELEASE_KEY, false));
    const p = gen(d);
    const uids = new Set(p.tasks.map(t => t.uid));
    p.tasks.forEach(t => t.preds.forEach(l => expect(uids.has(l.uid)).toBe(true)));
    expect(p.tasks.some(t => t.construction!.activityKey === 'brickwork' || t.construction!.activityKey === RELEASE_KEY)).toBe(false);
    // Services lost their brickwork predecessor; plaster is not wired straight to the services instead.
    ['elec_conduit', 'plumbing_concealed', 'ac_pipeline', 'inside_plaster'].forEach(k => {
      const t = byInstance(p, k + '@loc-F1');
      expect(t.preds).toEqual([]);
      expect(t.construction!.dependencyReview).toBe('needs-review');
    });
    d = draft(x => toggle(x, RELEASE_KEY, false));
    expect(planIssues(d, instancesOf(d), finalLinks(d, instancesOf(d)).links).some(i => i.level === 'warning' && /review\/release/.test(i.text))).toBe(true);
  });

  it('4. electrical conduit, concealed plumbing and AC pipeline stay parallel branches after brickwork', () => {
    const p = gen(draft());
    const services = ['elec_conduit', 'plumbing_concealed', 'ac_pipeline'].map(k => byInstance(p, k + '@loc-F1'));
    services.forEach(t => expect(predIds(p, t)).toEqual(['brickwork@loc-F1']));
    const s = OP.schedule(p);
    const starts = services.map(t => s.rows.find((r: any) => r.task.uid === t.uid).startDn);
    expect(new Set(starts).size).toBe(1);
  });

  it('5. inside plaster waits for the concealed-services release, which waits for each selected service', () => {
    const p = gen(draft(x => toggle(x, 'ac_pipeline', false)));
    expect(predIds(p, byInstance(p, 'inside_plaster@loc-F1'))).toEqual([RELEASE_KEY + '@loc-F1']);
    const release = byInstance(p, RELEASE_KEY + '@loc-F1');
    expect(release.milestone).toBe(true);
    expect(predIds(p, release).sort()).toEqual(['elec_conduit@loc-F1', 'plumbing_concealed@loc-F1']);
    expect(release.construction!.proposedLinks!.every(x => x.reason.length > 0)).toBe(true);
  });

  it('6. quantity-based duration uses the scheduler rounding and the site calendar', () => {
    const cfg = { ...blankConfig({ unit: 'sqft', milestone: false }), quantity: '10,000', productivity: '500' };
    const r = durationOf(cfg, false);
    expect(r.ok && r.days).toBe(20);
    expect(r.ok && r.calc).toMatch(/10,000 sq ft ÷ 500 sq ft per crew working day = 20/);
    const r2 = durationOf({ ...cfg, productivity: '450' }, false);
    expect(r2.ok && r2.days).toBe(OP.model.parseDuration('22.2222222222'));
    expect(r2.ok && r2.days).toBe(22.22);
    expect(r2.ok && r2.calc).toMatch(/rounded to 0.01 day/);

    // Brickwork is the first activity with no predecessor on First floor; give it 20 working days on a Mon–Sat
    // calendar with a site holiday, and compare with an independent day count.
    let d = draft(x => ({ ...x, exceptions: [{ name: 'Site holiday', from: '2026-12-25', to: '2026-12-25', working: false }] }));
    d = patchConfigs(d, instancesOf(d).filter(i => i.id === 'brickwork@loc-F1'), cfg);
    const p = gen(d), t = byInstance(p, 'brickwork@loc-F1');
    expect(t.duration).toBe(20);
    expect(t.construction!.durationMode).toBe('quantity');
    expect(t.construction!.productivity).toBe(500);
    const row = OP.schedule(p).rows.find((x: any) => x.task.uid === t.uid);
    let day = U.parseDate('2026-12-07'), n = 0, last = 0;
    while (n < 20) { if (U.weekday(day) !== 0 && U.iso(day) !== '2026-12-25') { n++; last = day; } day++; }
    expect(U.iso(row.startDn)).toBe('2026-12-07');
    expect(U.iso(row.finishDn)).toBe(U.iso(last));
  });

  it('7. rejects missing, zero, negative or non-numeric quantity and productivity in quantity mode', () => {
    const base = { ...blankConfig({ unit: 'sqft', milestone: false }), mode: 'quantity' as const };
    for (const [quantity, productivity] of [['', '500'], ['0', '500'], ['-5', '500'], ['abc', '500'], ['1000', ''], ['1000', '0'], ['1000', 'x']]) {
      const r = durationOf({ ...base, quantity, productivity }, false);
      expect(r.ok).toBe(false);
    }
    expect(durationOf({ ...base, quantity: '1000', productivity: '100', unit: '' }, false).ok).toBe(false);
    let d = draft();
    d = patchConfigs(d, instancesOf(d).filter(i => i.id === 'tiles@loc-F2'), { mode: 'quantity', quantity: '0', productivity: '100' });
    const res = generatePlan(d, CTX);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.errors.join(' ')).toMatch(/Tiles — Second floor: Enter a quantity greater than 0/);
    // Manual mode needs a duration; quantity and output are informational there.
    expect(durationOf({ ...base, mode: 'manual', duration: '' }, false).ok).toBe(false);
    expect(durationOf({ ...base, mode: 'manual', duration: '0' }, false).ok).toBe(false);
    expect(durationOf({ ...base, mode: 'manual', duration: '3ed' }, false).ok).toBe(false);
    expect(durationOf({ ...base, mode: 'manual', duration: '2w', quantity: '', productivity: '' }, false)).toMatchObject({ ok: true, days: 10 });
  });

  it('8. milestones are generated with zero duration whatever was typed', () => {
    let d = draft(x => toggle(x, 'handover', true));
    d = patchConfigs(d, instancesOf(d).filter(i => i.milestone), { mode: 'manual', duration: '5', quantity: '10' });
    const p = gen(d);
    const ms = p.tasks.filter(t => t.construction!.activityKey === RELEASE_KEY || t.construction!.activityKey === 'handover');
    expect(ms.length).toBe(4);
    ms.forEach(t => { expect(t.milestone).toBe(true); expect(t.duration).toBe(0); expect(t.construction!.quantity).toBeNull(); });
    const s = OP.schedule(p);
    ms.forEach(t => { const r = s.rows.find((x: any) => x.task.uid === t.uid); expect(r.duration).toBe(0); });
  });

  it('9. splitting by zone moves the scope to zone tasks without duplicating it on the floor', () => {
    let d = draft();
    d = reconcileLocations(d, addZone(addZone(d.locations, 'loc-F1', 'Flat 101'), 'loc-F1', 'Flat 102'));
    d = { ...d, activities: d.activities.map(a => (a.key === 'inside_plaster' ? { ...a, splits: { 'loc-F1': ['loc-F1-Z1', 'loc-F1-Z2'] } } : a)) };
    const insts = instancesOf(d);
    expect(insts.filter(i => i.key === 'inside_plaster' && i.topId === 'loc-F1' && i.executable).map(i => i.locationId)).toEqual(['loc-F1-Z1', 'loc-F1-Z2']);
    d = patchConfigs(d, insts.filter(i => i.key === 'inside_plaster' && i.executable), { mode: 'quantity', quantity: '3000', unit: 'sqft', productivity: '500' });
    const totals = quantityTotals(d, instancesOf(d)).get('inside_plaster')!.get('sqft')!;
    expect(totals).toEqual({ total: 9000, count: 3 }); // two zones on F1 + whole of F2, nothing counted twice
    const p = gen(d);
    const parent = byInstance(p, 'inside_plaster@loc-F1#split');
    expect(parent.construction!.role).toBe('split');
    expect(parent.construction!.quantity).toBeUndefined();
    const s = OP.schedule(p);
    expect(s.rows.find((r: any) => r.task.uid === parent.uid).summary).toBe(true);
    const zones = p.tasks.filter(t => t.construction!.activityKey === 'inside_plaster' && t.construction!.role === 'activity');
    expect(zones.map(t => [t.name, t.construction!.locationId, t.construction!.quantity])).toEqual([
      ['Inside plaster — Flat 101', 'loc-F1-Z1', 3000], ['Inside plaster — Flat 102', 'loc-F1-Z2', 3000], ['Inside plaster', 'loc-F2', 3000]
    ]);
    // The floor-level release is mapped onto each zone, and the mapping is explained.
    const z1 = byInstance(p, 'inside_plaster@loc-F1-Z1');
    expect(predIds(p, z1)).toEqual([RELEASE_KEY + '@loc-F1']);
    expect(z1.construction!.proposedLinks![0].reason).toMatch(/each zone/);
    // Putty (not split) waits for every zone of plaster.
    expect(predIds(p, byInstance(p, 'putty_1@loc-F1')).sort()).toEqual(['inside_plaster@loc-F1-Z1', 'inside_plaster@loc-F1-Z2']);
  });

  it('10. never links different floors on its own, but keeps an explicit cross-floor link', () => {
    let d = draft();
    const insts = instancesOf(d);
    const top = new Map(insts.map(i => [i.id, i.topId]));
    finalLinks(d, insts).links.forEach(l => expect(top.get(l.from)).toBe(top.get(l.to)));
    d = { ...d, addedLinks: [{ from: 'slab_concrete@loc-F1', to: 'columns@loc-F2', type: 'FS', lag: 0 }] };
    const p = gen(d);
    expect(predIds(p, byInstance(p, 'columns@loc-F2'))).toEqual(['slab_concrete@loc-F1']);
  });

  it('11. rejects self links, duplicates and loops', () => {
    let d = draft();
    const insts = instancesOf(d), links = finalLinks(d, insts).links;
    expect(addLinkProblem(insts, links, 'tiles@loc-F1', 'tiles@loc-F1')).toMatch(/itself/);
    expect(addLinkProblem(insts, links, 'brickwork@loc-F1', 'elec_conduit@loc-F1')).toMatch(/already exists/);
    expect(addLinkProblem(insts, links, 'putty_1@loc-F1', 'brickwork@loc-F1')).toMatch(/circular/);
    expect(addLinkProblem(insts, links, 'brickwork@loc-F1#split', 'tiles@loc-F1')).toMatch(/Choose activities/);
    expect(addLinkProblem(insts, links, 'brickwork@loc-F1', 'tiles@loc-F1')).toBe('');
    d = { ...d, addedLinks: [{ from: 'putty_1@loc-F1', to: 'brickwork@loc-F1', type: 'FS', lag: 0 }] };
    const probs = linkProblems(d, instancesOf(d), finalLinks(d, instancesOf(d)).links);
    expect(probs['']).toMatch(/^Circular dependency: .*Putty — first coat — First floor → Brickwork — First floor/);
    const res = generatePlan(d, CTX);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.errors.join(' ')).toMatch(/Circular dependency/);
  });

  it('12. save and reload keeps the outline, links and construction metadata', () => {
    let d = draft(x => {
      const y = reconcileLocations(x, addZone(x.locations, 'loc-F2', 'Flat 201'));
      return { ...y, engineerId: 'u1', activities: y.activities.map(a => (a.key === 'tiles' ? { ...a, splits: { 'loc-F2': ['loc-F2-Z1'] } } : a)) };
    });
    d = patchConfigs(d, instancesOf(d).filter(i => i.key === 'brickwork'), { contractor: 'Sharma Builders', crew: 'Mason crew A', engineerId: 'u1' });
    const p = gen(d);
    const back: Project = OP.io.fromJSON(OP.io.toJSON(p));
    expect(back.tasks.map(t => [t.uid, t.level, t.name, t.duration, t.milestone, t.preds, t.assignments, t.construction]))
      .toEqual(p.tasks.map(t => [t.uid, t.level, t.name, t.duration, t.milestone, t.preds, t.assignments, t.construction]));
    expect(back.construction).toEqual(p.construction);
    expect(back.construction!.contractors).toEqual([{ id: 'con-1', name: 'Sharma Builders' }]);
    expect(back.construction!.buildings[0].engineer).toEqual({ userId: 'u1', name: 'Asha Engineer' });
    const bw = byInstance(back, 'brickwork@loc-F1');
    expect(bw.construction).toMatchObject({ contractorId: 'con-1', engineer: { userId: 'u1', name: 'Asha Engineer' } });
    expect(back.resources.find(r => r.uid === bw.construction!.crewResourceUid)!.name).toBe('Mason crew A');
    expect(bw.assignments).toEqual([{ res: bw.construction!.crewResourceUid, units: 100 }]);
    expect(back.construction!.review.state).toBe('draft');
    expect(back.status).toBe('Draft');
    expect(back.baseline).toBeNull();
  });

  it('13. ordinary projects load unchanged, and broken construction data is cleaned up', () => {
    const demo = OP.demo();
    const back = OP.io.fromJSON(OP.io.toJSON(demo));
    expect(back).toEqual(OP.model.normalize(JSON.parse(OP.io.toJSON(demo))));
    expect('construction' in back).toBe(false);
    expect(back.tasks.some((t: Task) => 'construction' in t)).toBe(false);
    const legacy = { name: 'Old', tasks: [{ uid: 1, name: 'A' }, { uid: 2, name: 'B', construction: 'oops' }], resources: [], construction: [1] };
    const n = OP.model.normalize(legacy);
    expect(n.construction).toBeUndefined();
    expect(n.tasks[1].construction).toBeUndefined();
    // Two tasks claiming one identity (e.g. pasted in by hand) get separate identities.
    const dup = OP.model.normalize({ tasks: [{ uid: 1, construction: { instanceId: 'x@1' } }, { uid: 2, construction: { instanceId: 'x@1' } }], resources: [] });
    expect(dup.tasks.map((t: Task) => t.construction!.instanceId)).toEqual(['x@1', 'x@1~2']);
  });

  it('14. repeated submission sends one request; a failed one can be retried', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'p1' });
    const submit = createSubmitter(send);
    const [a, b] = await Promise.all([submit(), submit()]);
    expect(await submit()).toBe(a);
    expect(a).toBe(b);
    expect(send).toHaveBeenCalledTimes(1);
    const flaky = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: 'p2' });
    const submit2 = createSubmitter(flaky);
    await expect(Promise.all([submit2(), submit2()])).rejects.toThrow('network');
    expect(flaky).toHaveBeenCalledTimes(1);
    expect(await submit2()).toEqual({ id: 'p2' });
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('does not invent quantities, productivity, contractors or engineers', () => {
    const d = newDraft('2026-12-07', 'r');
    expect(Object.keys(d.config)).toEqual([]);
    const cfg = blankConfig(d.activities.find(a => a.key === 'brickwork'));
    expect([cfg.quantity, cfg.productivity, cfg.duration, cfg.contractor, cfg.engineerId]).toEqual(['', '', '', '', '']);
    expect(d.workDays).toEqual([]); // the site calendar is chosen, not assumed
    const issues = planIssues({ ...d, name: 'X' }, instancesOf(d), []);
    expect(issues.some(i => i.level === 'error' && /working days/.test(i.text))).toBe(true);
    expect(issues.some(i => i.level === 'error' && /Brickwork — First floor/.test(i.text))).toBe(true);
    expect(issues.filter(i => i.level === 'optional').length).toBeGreaterThan(0);
  });

  it('schedules the generated plan without loops; summaries roll up instead of adding durations', () => {
    const p = gen(draft());
    const s = OP.schedule(p);
    expect(s.cycle).toEqual([]);
    const floor = s.rows.find((r: any) => r.task.construction.instanceId === 'location@loc-F1');
    const leaves = floor.leaves.map((i: number) => s.rows[i]);
    expect(floor.startDn).toBe(Math.min(...leaves.map((r: any) => r.startDn)));
    expect(floor.finishDn).toBe(Math.max(...leaves.map((r: any) => r.finishDn)));
    const sum = leaves.reduce((a: number, r: any) => a + r.duration, 0);
    expect(floor.duration).toBeLessThan(sum);
  });
});
