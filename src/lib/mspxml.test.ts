import { describe, expect, it } from 'vitest';
import OP from '../core';
import { fromMspXml, parseXml, toMspXml } from './mspxml';

const M = OP.model;
const iso = (dn: number) => OP.util.iso(dn);

function sample() {
  const p = M.blank();
  p.name = 'Fit-out & <launch>';
  p.organization = 'Acme "Ltd"';
  p.start = '2026-01-05';
  p.workDays = [1, 2, 3, 4, 5, 6];
  p.exceptions = [{ name: 'Holiday', from: '2026-01-14', to: '2026-01-15', working: false }];
  p.criticalSlack = 1;
  const ann = M.newResource(p, { name: 'Ann', initials: 'A', rate: 40, costPerUse: 10, maxUnits: 100 });
  const bolts = M.newResource(p, { name: 'Bolts', kind: 'Material', rate: 2, materialLabel: 'box' });
  const fee = M.newResource(p, { name: 'Permit', kind: 'Cost' });
  p.resources.push(ann, bolts, fee);
  const t = (fields: any) => { const x = M.newTask(p, fields); p.tasks.push(x); return x; };
  const phase = t({ name: 'Phase 1', level: 1 });
  const a = t({ name: 'Design', level: 2, duration: 5, notes: 'line1 & line2', deadline: '2026-02-27' });
  const b = t({ name: 'Build', level: 2, duration: 8, type: 'FixedDuration', constraint: 'SNET', constraintDate: '2026-01-19', percent: 40, fixedCost: 500 });
  const c = t({ name: 'Cure', level: 2, duration: 3, elapsed: true });
  const d = t({ name: 'Inspect', level: 2, duration: 1 });
  const e = t({ name: 'Frozen', level: 2, duration: 2, mode: 'manual', manualStart: '2026-02-02' });
  const f = t({ name: 'Dropped', level: 2, duration: 4, active: false });
  const g = t({ name: 'Go live', level: 1, duration: 0, milestone: true });
  b.preds = [{ uid: a.uid, type: 'FS', lag: 2 }];
  c.preds = [{ uid: b.uid, type: 'SS', lag: 50, unit: '%' }];
  d.preds = [{ uid: c.uid, type: 'FS', lag: 3, unit: 'ed' }, { uid: a.uid, type: 'FF', lag: -1 }];
  g.preds = [{ uid: d.uid, type: 'FS', lag: 0 }, { uid: f.uid, type: 'FS', lag: 0 }];
  a.assignments = [{ res: ann.uid, units: 50 }, { res: fee.uid, units: 250 }];
  b.assignments = [{ res: bolts.uid, units: 12 }];
  void phase; void e;
  return M.normalize(p);
}

describe('XML reader', () => {
  it('handles entities, CDATA, attributes, comments and self-closing tags', () => {
    const n = parseXml('<?xml version="1.0"?><!-- hi --><a x="1"><b>1 &lt; 2 &amp; &#65;&#x42;</b><c/><d><![CDATA[<raw>]]></d></a>');
    expect(n.name).toBe('a');
    expect(n.kids.map(k => k.name)).toEqual(['b', 'c', 'd']);
    expect(n.kids[0].text).toBe('1 < 2 & AB');
    expect(n.kids[2].text).toBe('<raw>');
  });

  it('rejects malformed XML', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/malformed/);
    expect(() => parseXml('<a><b>')).toThrow(/malformed/);
    expect(() => parseXml('   ')).toThrow();
  });
});

describe('MS Project XML round trip', () => {
  const p = sample();
  const xml = toMspXml(p);
  const { project: q, warnings } = fromMspXml(xml);

  it('writes a well-formed MSPDI file', () => {
    expect(xml).toContain('xmlns="http://schemas.microsoft.com/project"');
    expect(() => parseXml(xml)).not.toThrow();
    expect(xml).toContain('Fit-out &amp; &lt;launch&gt;');
  });

  it('keeps the project settings and calendar', () => {
    expect(q.name).toBe(p.name);
    expect(q.organization).toBe('Acme "Ltd"');
    expect(q.workDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(q.exceptions).toEqual([{ name: 'Holiday', from: '2026-01-14', to: '2026-01-15', working: false }]);
    expect(q.criticalSlack).toBe(1);
    expect(q.hoursPerDay).toBe(8);
    expect(warnings).toEqual([]);
  });

  it('keeps tasks, outline, durations, constraints and flags', () => {
    expect(q.tasks.map(t => [t.name, t.level])).toEqual(p.tasks.map((t: any) => [t.name, t.level]));
    const byName = (n: string) => q.tasks.find(t => t.name === n)!;
    expect(byName('Design').notes).toBe('line1 & line2');
    expect(byName('Design').deadline).toBe('2026-02-27');
    expect(byName('Build').constraint).toBe('SNET');
    expect(byName('Build').constraintDate).toBe('2026-01-19');
    expect(byName('Build').type).toBe('FixedDuration');
    expect(byName('Build').percent).toBe(40);
    expect(byName('Build').fixedCost).toBe(500);
    expect(byName('Cure').elapsed).toBe(true);
    expect(byName('Cure').duration).toBe(3);
    expect(byName('Frozen').mode).toBe('manual');
    expect(byName('Frozen').manualStart).toBe('2026-02-02');
    expect(byName('Dropped').active).toBe(false);
    expect(byName('Go live').milestone).toBe(true);
  });

  it('keeps links with every lag unit', () => {
    expect(M.formatPreds(q, q.tasks[2])).toBe('2FS+2d');
    expect(M.formatPreds(q, q.tasks[3])).toBe('3SS+50%');
    expect(M.formatPreds(q, q.tasks[4])).toBe('4FS+3ed, 2FF-1d');
    expect(M.formatPreds(q, q.tasks[7])).toBe('5, 7');
  });

  it('keeps resources and assignments', () => {
    expect(q.resources.map(r => [r.name, r.kind, r.rate, r.costPerUse])).toEqual([['Ann', 'Work', 40, 10], ['Bolts', 'Material', 2, 0], ['Permit', 'Cost', 0, 0]]);
    expect(q.resources[1].materialLabel).toBe('box');
    const design = q.tasks.find(t => t.name === 'Design')!;
    expect(design.assignments.map(a => a.units).sort((x, y) => x - y)).toEqual([50, 250]);
    expect(q.tasks.find(t => t.name === 'Build')!.assignments[0].units).toBe(12);
  });

  it('gives the same schedule and cost after the trip', () => {
    const s1 = OP.schedule(p), s2 = OP.schedule(q);
    expect(s2.rows.map((r: any) => [iso(r.startDn), iso(r.finishDn)])).toEqual(s1.rows.map((r: any) => [iso(r.startDn), iso(r.finishDn)]));
    expect(s2.totalCost).toBeCloseTo(s1.totalCost, 2);
    expect(iso(s2.finishDn)).toBe(iso(s1.finishDn));
  });
});

describe('reading files written by MS Project', () => {
  const file = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Website.xml</Name><Title>Website</Title><Company>Contoso</Company>
  <ScheduleFromStart>1</ScheduleFromStart><StartDate>2026-03-02T08:00:00</StartDate><MinutesPerDay>420</MinutesPerDay>
  <CalendarUID>2</CalendarUID>
  <Calendars>
    <Calendar><UID>1</UID><Name>24 Hours</Name><IsBaseCalendar>1</IsBaseCalendar></Calendar>
    <Calendar><UID>2</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar>
      <WeekDays>
        <WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay>
        <WeekDay><DayType>2</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>3</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>4</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>5</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>6</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay>
        <WeekDay><DayType>0</DayType><DayWorking>0</DayWorking><TimePeriod><FromDate>2026-03-09T00:00:00</FromDate><ToDate>2026-03-09T23:59:00</ToDate></TimePeriod></WeekDay>
      </WeekDays>
    </Calendar>
  </Calendars>
  <Tasks>
    <Task><UID>0</UID><ID>0</ID><Name>Website</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>5</UID><ID>1</ID><Name>Build</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary><Duration>PT21H0M0S</Duration></Task>
    <Task><UID>6</UID><ID>2</ID><Name>Wireframes</Name><OutlineLevel>2</OutlineLevel><Duration>PT21H0M0S</Duration><DurationFormat>7</DurationFormat><PercentComplete>100</PercentComplete></Task>
    <Task><UID>7</UID><ID>3</ID><Name>Code</Name><OutlineLevel>2</OutlineLevel><Duration>PT28H0M0S</Duration><ConstraintType>4</ConstraintType><ConstraintDate>2026-03-16T08:00:00</ConstraintDate>
      <PredecessorLink><PredecessorUID>6</PredecessorUID><Type>1</Type><LinkLag>8400</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
      <PredecessorLink><PredecessorUID>99</PredecessorUID><Type>1</Type></PredecessorLink></Task>
    <Task><UID>8</UID><ID>4</ID><Name>Launch</Name><OutlineLevel>1</OutlineLevel><Milestone>1</Milestone><Duration>PT0H0M0S</Duration>
      <PredecessorLink><PredecessorUID>7</PredecessorUID><Type>1</Type></PredecessorLink></Task>
  </Tasks>
  <Resources>
    <Resource><UID>0</UID><ID>0</ID><Name>Unassigned</Name></Resource>
    <Resource><UID>1</UID><ID>1</ID><Name>Priya Shah</Name><Type>1</Type><MaxUnits>1.5</MaxUnits><StandardRate>400</StandardRate><StandardRateFormat>3</StandardRateFormat></Resource>
  </Resources>
  <Assignments>
    <Assignment><UID>1</UID><TaskUID>7</TaskUID><ResourceUID>1</ResourceUID><Units>0.5</Units></Assignment>
    <Assignment><UID>2</UID><TaskUID>6</TaskUID><ResourceUID>-65535</ResourceUID></Assignment>
  </Assignments>
</Project>`;
  const { project: q, warnings } = fromMspXml(file);

  it('reads the project, 7-hour day, and the calendar named by CalendarUID', () => {
    expect(q.name).toBe('Website');
    expect(q.organization).toBe('Contoso');
    expect(q.start).toBe('2026-03-02');
    expect(q.hoursPerDay).toBe(7);
    expect(q.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(q.exceptions).toEqual([{ name: 'Exception', from: '2026-03-09', to: '2026-03-09', working: false }]);
  });

  it('skips the project summary task and converts durations by the project day', () => {
    expect(q.tasks.map(t => t.name)).toEqual(['Build', 'Wireframes', 'Code', 'Launch']);
    expect(q.tasks.map(t => t.level)).toEqual([1, 2, 2, 1]);
    expect(q.tasks[1].duration).toBe(3);
    expect(q.tasks[2].duration).toBe(4);
    expect(q.tasks[1].percent).toBe(100);
    expect(q.tasks[3].milestone).toBe(true);
  });

  it('converts link lag from tenths of a minute and drops links to missing tasks', () => {
    expect(q.tasks[2].preds).toEqual([{ uid: q.tasks[1].uid, type: 'FS', lag: 2 }]);
    expect(warnings.join(' ')).toMatch(/1 link/);
    expect(q.tasks[2].constraint).toBe('SNET');
    expect(q.tasks[2].constraintDate).toBe('2026-03-16');
  });

  it('reads resources with rate units and ignores unassigned placeholders', () => {
    expect(q.resources).toHaveLength(1);
    expect(q.resources[0]).toMatchObject({ name: 'Priya Shah', kind: 'Work', maxUnits: 150, rate: 57.14 });
    expect(q.tasks[2].assignments).toEqual([{ res: q.resources[0].uid, units: 50 }]);
    expect(q.tasks[1].assignments).toEqual([]);
  });

  it('schedules the imported plan without loops', () => {
    const s = OP.schedule(q);
    expect(s.cycle).toEqual([]);
    expect(iso(s.rows[2].startDn)).toBe('2026-03-16'); // start no earlier than
  });

  it('rejects other XML and empty plans', () => {
    expect(() => fromMspXml('<Other/>')).toThrow(/Project/);
    expect(() => fromMspXml('<Project><Tasks/></Project>')).toThrow(/no tasks/);
  });
});
