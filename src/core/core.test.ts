import { describe, expect, it } from 'vitest';
import OP from './index';

const M = OP.model;

type Spec = { name: string; duration: number; preds?: string };

function plan(specs: Spec[]) {
  let p = M.blank();
  p.start = '2026-01-05';
  specs.forEach(sp => p.tasks.push(M.newTask(p, { name: sp.name, duration: sp.duration })));
  specs.forEach((sp, i) => { if (sp.preds) p.tasks[i].preds = M.parsePreds(p, sp.preds, p.tasks[i].uid).preds; });
  p = M.normalize(p);
  return { p, s: OP.schedule(p) };
}

const row = (s: any, name: string) => s.rows.find((r: any) => r.task.name === name);

describe('scheduler', () => {
  it('chains finish-to-start links and finds the critical path', () => {
    const { s } = plan([
      { name: 'A', duration: 3 },
      { name: 'B', duration: 2, preds: '1' },
      { name: 'C', duration: 1 }
    ]);
    expect(row(s, 'B').es).toBe(3);
    expect(s.duration).toBe(5);
    expect(row(s, 'A').critical).toBe(true);
    expect(row(s, 'B').critical).toBe(true);
    expect(row(s, 'C').critical).toBe(false);
    expect(row(s, 'C').slack).toBe(4);
  });

  it('applies lag and start-to-start links', () => {
    const { s } = plan([
      { name: 'A', duration: 3 },
      { name: 'B', duration: 2, preds: '1FS+2d' },
      { name: 'C', duration: 2, preds: '1SS' }
    ]);
    expect(row(s, 'B').es).toBe(5);
    expect(row(s, 'C').es).toBe(0);
  });

  it('reports a dependency loop', () => {
    const { p } = plan([{ name: 'A', duration: 1 }, { name: 'B', duration: 1, preds: '1' }]);
    p.tasks[0].preds = [{ uid: p.tasks[1].uid, type: 'FS', lag: 0 }];
    expect(OP.schedule(p).cycle.length).toBeGreaterThan(0);
  });

  it('schedules the sample project without loops', () => {
    const p = OP.demo(), s = OP.schedule(p);
    expect(s.cycle).toEqual([]);
    expect(s.rows.some((r: any) => r.critical && !r.summary)).toBe(true);
    expect(s.finishDn).toBeGreaterThan(s.startDn);
  });
});

// 2026-01-05 is a Monday.
function plan2(specs: (Spec & Record<string, any>)[], extra: Record<string, any> = {}) {
  let p = M.blank();
  p.start = '2026-01-05';
  Object.assign(p, extra);
  specs.forEach(sp => {
    const { preds: _pr, ...fields } = sp;
    p.tasks.push(M.newTask(p, fields));
  });
  specs.forEach((sp, i) => { if (sp.preds) p.tasks[i].preds = M.parsePreds(p, sp.preds, p.tasks[i].uid).preds; });
  p = M.normalize(p);
  return { p, s: OP.schedule(p) };
}
const iso = (dn: number) => OP.util.iso(dn);

describe('working calendar', () => {
  it('honours a custom work week', () => {
    // Sunday-Thursday week: a 3-day task from Monday runs Mon-Wed, a 5-day task from Mon ends on Sun.
    const { s } = plan2([{ name: 'A', duration: 5 }], { workDays: [0, 1, 2, 3, 4] });
    expect(iso(row(s, 'A').startDn)).toBe('2026-01-05');
    expect(iso(row(s, 'A').finishDn)).toBe('2026-01-11');
  });

  it('skips exception ranges and counts working exceptions', () => {
    const off = plan2([{ name: 'A', duration: 3 }], { exceptions: [{ name: 'Shutdown', from: '2026-01-06', to: '2026-01-07', working: false }] });
    expect(iso(row(off.s, 'A').finishDn)).toBe('2026-01-09'); // Mon, Thu, Fri
    const sat = plan2([{ name: 'A', duration: 6 }, { name: 'B', duration: 1, preds: '1' }], { exceptions: [{ name: 'Saturday shift', from: '2026-01-10', to: '2026-01-10', working: true }] });
    expect(iso(row(sat.s, 'A').finishDn)).toBe('2026-01-10'); // Mon-Fri, then the working Saturday
    expect(iso(row(sat.s, 'B').startDn)).toBe('2026-01-12'); // Sunday is still off
  });

  it('turns the old holiday list into calendar exceptions', () => {
    const { p, s } = plan2([{ name: 'A', duration: 3 }], { holidays: ['2026-01-06', 'not a date'] });
    expect(p.holidays).toEqual([]);
    expect(p.exceptions).toEqual([{ name: 'Holiday', from: '2026-01-06', to: '2026-01-06', working: false }]);
    expect(iso(row(s, 'A').finishDn)).toBe('2026-01-08'); // Mon, Wed, Thu
    expect(M.normalize(JSON.parse(JSON.stringify(p))).exceptions).toHaveLength(1);
  });

  it('never loops forever when every weekday is switched off', () => {
    const { p } = plan2([{ name: 'A', duration: 2 }], { workDays: [] });
    expect(p.workDays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('links with percent and elapsed lag', () => {
  it('applies a percentage lag of the predecessor duration', () => {
    const { s } = plan2([{ name: 'A', duration: 10 }, { name: 'B', duration: 1, preds: '1SS+50%' }]);
    expect(row(s, 'B').es).toBe(5);
  });

  it('applies an elapsed lag across a weekend', () => {
    // A runs Mon 5 - Wed 7. FS+3ed: three calendar days after Wed is Sat, so B starts Mon 12.
    const { s } = plan2([{ name: 'A', duration: 3 }, { name: 'B', duration: 1, preds: '1FS+3ed' }]);
    expect(iso(row(s, 'B').startDn)).toBe('2026-01-12');
  });

  it('reads and writes the new lag formats', () => {
    const { p } = plan2([{ name: 'A', duration: 1 }, { name: 'B', duration: 1 }, { name: 'C', duration: 1 }]);
    const res = M.parsePreds(p, '1FS+50%, 2SS+2ed, 1FF-1w, 2+8h', p.tasks[2].uid);
    expect(res.errors).toEqual([]);
    expect(res.preds.map((l: any) => [l.type, l.lag, l.unit || 'd'])).toEqual([['FS', 50, '%'], ['SS', 2, 'ed'], ['FF', -5, 'd'], ['FS', 1, 'd']]);
    p.tasks[2].preds = res.preds;
    expect(M.formatPreds(p, p.tasks[2])).toBe('1FS+50%, 2SS+2ed, 1FF-5d, 2FS+1d');
  });
});

describe('durations', () => {
  it('parses working and elapsed units', () => {
    const d = (t: string) => M.parseDurationEx(t, 8);
    expect(d('3')).toEqual({ days: 3, elapsed: false });
    expect(d('2w')).toEqual({ days: 10, elapsed: false });
    expect(d('1mo')).toEqual({ days: 20, elapsed: false });
    expect(d('4h')).toEqual({ days: 0.5, elapsed: false });
    expect(d('240min')).toEqual({ days: 0.5, elapsed: false });
    expect(d('3ed')).toEqual({ days: 3, elapsed: true });
    expect(d('2ew')).toEqual({ days: 14, elapsed: true });
    expect(d('5d?')).toEqual({ days: 5, elapsed: false });
    expect(d('soon')).toBeNull();
  });

  it('runs an elapsed task through the weekend', () => {
    // 4 calendar days from Thu 8 Jan covers Thu, Fri, Sat, Sun: only two working days.
    const { s } = plan2([{ name: 'Lead', duration: 3 }, { name: 'Cure', duration: 4, elapsed: true, preds: '1' }, { name: 'Next', duration: 1, preds: '2' }]);
    const cure = row(s, 'Cure');
    expect(iso(cure.startDn)).toBe('2026-01-08');
    expect(cure.shown).toBe(4);
    expect(cure.duration).toBe(2);
    expect(iso(row(s, 'Next').startDn)).toBe('2026-01-12');
  });
});

describe('manual scheduling', () => {
  it('keeps typed dates even when links say otherwise, and flags the conflict', () => {
    const { s } = plan2([
      { name: 'A', duration: 5 },
      { name: 'B', duration: 2, preds: '1', mode: 'manual', manualStart: '2026-01-06' }
    ]);
    expect(iso(row(s, 'B').startDn)).toBe('2026-01-06');
    expect(row(s, 'B').conflict).toMatch(/before its predecessors/);
    expect(row(s, 'B').manual).toBe(true);
  });

  it('derives the duration from manual start and finish', () => {
    const { s } = plan2([{ name: 'A', duration: 1, mode: 'manual', manualStart: '2026-01-05', manualFinish: '2026-01-09' }]);
    expect(row(s, 'A').duration).toBe(5);
  });

  it('still drives its successors', () => {
    const { s } = plan2([
      { name: 'A', duration: 1, mode: 'manual', manualStart: '2026-01-12' },
      { name: 'B', duration: 1, preds: '1' }
    ]);
    expect(iso(row(s, 'B').startDn)).toBe('2026-01-13');
  });
});

describe('inactive tasks', () => {
  it('drop out of the schedule, the cost and the critical path', () => {
    const { s } = plan2([
      { name: 'A', duration: 2, fixedCost: 100 },
      { name: 'Cut', duration: 10, fixedCost: 900, active: false, preds: '1' },
      { name: 'B', duration: 1, preds: '2' }
    ]);
    expect(row(s, 'Cut').inactive).toBe(true);
    expect(row(s, 'Cut').critical).toBe(false);
    expect(row(s, 'Cut').cost).toBe(0);
    expect(s.totalCost).toBe(100);
    expect(row(s, 'B').es).toBe(0); // the link from the inactive task no longer applies
    expect(s.duration).toBe(2);
  });
});

describe('scheduling from the finish date', () => {
  it('works backwards so the last task ends on the chosen date', () => {
    const { s } = plan2(
      [{ name: 'A', duration: 3 }, { name: 'B', duration: 2, preds: '1' }, { name: 'Side', duration: 1 }],
      { scheduleFrom: 'finish', finishDate: '2026-02-13' }
    );
    expect(iso(s.finishDn)).toBe('2026-02-13');
    expect(iso(row(s, 'B').finishDn)).toBe('2026-02-13');
    expect(iso(row(s, 'A').startDn)).toBe('2026-02-09');
    // As late as possible: the unlinked task sits at the end too.
    expect(iso(row(s, 'Side').startDn)).toBe('2026-02-13');
  });

  it('lands on the finish date across holidays', () => {
    const { s } = plan2(
      [{ name: 'A', duration: 6 }],
      { scheduleFrom: 'finish', finishDate: '2026-01-23', exceptions: [{ name: 'Off', from: '2026-01-19', to: '2026-01-20', working: false }] }
    );
    expect(iso(s.finishDn)).toBe('2026-01-23');
    expect(iso(row(s, 'A').startDn)).toBe('2026-01-14'); // 23, 22, 21, 16, 15, 14: the 19th and 20th are off
  });
});

describe('critical path threshold', () => {
  it('treats tasks within the slack threshold as critical', () => {
    const specs = [{ name: 'A', duration: 5 }, { name: 'B', duration: 4 }];
    expect(row(plan2(specs).s, 'B').critical).toBe(false);
    expect(row(plan2(specs, { criticalSlack: 1 }).s, 'B').critical).toBe(true);
  });
});

describe('predecessor parsing', () => {
  it('reads link types and lag, and reports bad entries', () => {
    const { p } = plan([{ name: 'A', duration: 1 }, { name: 'B', duration: 1 }, { name: 'C', duration: 1 }]);
    const res = M.parsePreds(p, '1, 2SS+2d, 3FF-1d, x, 9', p.tasks[2].uid);
    expect(res.preds).toEqual([
      { uid: p.tasks[0].uid, type: 'FS', lag: 0 },
      { uid: p.tasks[1].uid, type: 'SS', lag: 2 }
    ]);
    expect(res.errors).toEqual(['3FF-1d', 'x', '9']);
  });
});

describe('project files', () => {
  it('round-trips a project through JSON', () => {
    const p = OP.demo();
    const back = OP.io.fromJSON(OP.io.toJSON(p));
    expect(back).toEqual(M.normalize(JSON.parse(JSON.stringify(p))));
  });

  it('rejects files that are not OpenPlan projects', () => {
    expect(() => OP.io.fromJSON('{"hello":1}')).toThrow('Not an OpenPlan project file.');
    expect(() => OP.io.fromJSON('not json')).toThrow();
  });
});

describe('typed dates', () => {
  const d = (s: string) => { const n = OP.util.parseLoose(s); return n == null ? null : OP.util.iso(n); };
  it('reads the formats people type', () => {
    expect(d('2026-01-05')).toBe('2026-01-05');
    expect(d('5 Jan 26')).toBe('2026-01-05');
    expect(d('5-Jan-2026')).toBe('2026-01-05');
    expect(d('05/01/2026')).toBe('2026-01-05');
    expect(d('29 February 2028')).toBe('2028-02-29');
  });
  it('rejects nonsense and impossible dates', () => {
    expect(d('soon')).toBeNull();
    expect(d('31 Feb 26')).toBeNull();
    expect(d('5 Foo 26')).toBeNull();
    expect(d('')).toBeNull();
  });
});

describe('util', () => {
  it('escapes HTML', () => {
    expect(OP.util.esc('<a href="x">\'&')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
});
