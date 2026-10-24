import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import '@fontsource-variable/archivo';
import OP from '../core';
import { useApp, S, ask } from '../store';
import Icon from '../components/Icon';
import type { Schedule } from '../types';

const C = OP.charts;
const REPO = 'https://github.com/AbhishekAhirwar123/MS-Project-Clone';
// The page title from index.html; the app replaces it with the project name.
const PAGE_TITLE = document.title;

export const enterApp = () => { location.hash = 'app'; };
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

function openSample() {
  ask('Open the sample project? Your current plan can be restored with Undo.', () => {
    S().replaceProject(OP.demo(), 'Sample project loaded');
    enterApp();
  }, 'Open sample');
}

const STEPS: [string, string][] = [
  ['List the work', 'Type your tasks and durations, and indent them into phases. That outline becomes your WBS.'],
  ['Link the tasks', 'Say which task depends on which. Neo Project schedules everything and finds the critical path.'],
  ['Add people and costs', 'Assign team members, rates and materials. Overloaded people are flagged and costs are totalled.'],
  ['Export the results', 'Download the Gantt chart, network diagram, WBS, budget and reports for your document.']
];

const OUTPUTS = [
  'Gantt chart with milestones and the critical path',
  'Network diagram with ES, EF, LS, LF and slack',
  'Work breakdown structure (WBS)',
  'Team structure and resource allocation',
  'Budget with cost per task, phase and person',
  'Baseline, progress tracking and earned value'
];

const SPEC: [string, string][] = [
  ['Scheduling', 'Summary tasks, FS/SS/FF/SF links with lag, milestones, constraints, deadlines, split and recurring tasks, working calendars.'],
  ['Critical path', 'Forward and backward pass with ES, EF, LS, LF, total and free slack, highlighted in every view.'],
  ['Resources', 'Work, material and cost resources, rates and rate changes, vacations, a weekly workload view and leveling.'],
  ['Tracking', 'Baselines, % complete, actual dates, a status date, and earned value: SPI, CPI and EAC.'],
  ['Cost', 'Budget versus planned cost, cost by work package and by resource, monthly and cumulative spend.'],
  ['Output', '10 printable reports, PNG and SVG export of every chart, and CSV export.']
];

const STATS: [string, string][] = [['8', 'views of one plan'], ['10', 'ready-made reports'], ['4', 'dependency link types'], ['4', 'file formats']];

const AUDIENCE: [string, string, string][] = [
  ['report', 'Students', 'Coursework that asks for a WBS, Gantt chart, network diagram, resource plan and budget, all produced from one plan.'],
  ['users', 'Small teams', 'Plan phases or sprints, assign people, and see who is overloaded before it becomes a problem, with no licences to buy.'],
  ['target', 'Lecturers', 'One free tool the whole class can open in a browser, with charts and reports ready to hand in.']
];

const FAQ: [string, string][] = [
  ['Is Neo Project really free?', 'Yes. There are no accounts, trials or paid tiers.'],
  ['Where is my project stored?', 'In this browser, saved automatically as you work, and in .neoproject files you save to your computer. Your plan is never uploaded anywhere.'],
  ['Can I put the charts in my report?', 'Yes. Every chart exports as PNG or SVG, and each of the 10 reports prints or saves as a PDF.'],
  ['Does it work on a phone?', 'This page does. The planner itself has a spreadsheet-style grid and a timeline, so it works best on a laptop or desktop screen.']
];

function useSample() {
  return useMemo(() => {
    const p = OP.demo(), s: Schedule = OP.schedule(p);
    const sprint = s.rows.find(r => r.summary && r.task.name.startsWith('Sprint 1'));
    return {
      gantt: C.gantt({ p, s, rows: s.rows, zoom: 'week', critical: true, table: true }).svg,
      network: C.network({ p, s, rows: sprint ? sprint.leaves.map(i => s.rows[i]) : s.rows, critical: true, dates: false, title: sprint ? 'Sprint 1' : 'Sample project' }).svg,
      wbs: C.wbs({ p, s, depth: 2 }).svg,
      cost: C.costChart({ p, data: C.monthlyCost(p, s), kind: 'cumulative' })
    };
  }, []);
}

const TABS: [keyof ReturnType<typeof useSample>, string, string, string][] = [
  ['gantt', 'Gantt chart', 'gantt', 'Schedule with milestones and the critical path in red.'],
  ['network', 'Network diagram', 'network', 'Activity-on-node with ES, EF, LS, LF and slack for each task.'],
  ['wbs', 'WBS', 'tree', 'Work breakdown structure generated from your task outline.'],
  ['cost', 'Budget', 'wallet', 'Cumulative planned cost against your approved budget.']
];

function Preview({ sample }: { sample: ReturnType<typeof useSample> }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('gantt');
  const cur = TABS.find(t => t[0] === tab)!;
  return (
    <div className="lp-preview">
      <div className="lp-tabs" role="tablist" aria-label="Preview">
        {TABS.map(([k, label, icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <Icon name={icon} />{label}
          </button>
        ))}
      </div>
      <div className="lp-shot">
        <div className="lp-shot-bar">
          <img className="logo" src="./assets/logo.png" alt="" width={16} height={16} />
          <span>Library Booking App (Sample) — {cur[1]}</span>
        </div>
        <div className={'lp-shot-body ' + tab} role="tabpanel" dangerouslySetInnerHTML={{ __html: sample[tab] }} />
      </div>
      <p className="lp-caption">{cur[3]} Drawn live from the sample project.</p>
    </div>
  );
}

export default function Landing() {
  const st = useApp();
  const sample = useSample();
  useEffect(() => { document.title = PAGE_TITLE; }, []);
  return (
    <div className="landing">
      <header className="lp-nav">
        <a className="lp-brand" href="#" onClick={e => { e.preventDefault(); document.querySelector('.landing')?.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <img className="logo" src="./assets/logo.png" alt="" width={26} height={26} />Neo Project
        </a>
        <nav className="lp-links">
          <button onClick={() => scrollTo('how')}>How it works</button>
          <button onClick={() => scrollTo('outputs')}>What you get</button>
          <button onClick={() => scrollTo('included')}>Features</button>
        </nav>
        <button className="lp-theme" aria-label="Toggle dark mode" title="Dark / light" onClick={() => st.setUI({ theme: st.theme === 'dark' ? 'light' : 'dark' })}>
          <Icon name={st.theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className="lp-btn" onClick={enterApp}>Open the app</button>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-top">
            <div className="lp-hero-copy">
              <p className="lp-label">Free online project planning</p>
              <h1>Turn a task list into a complete project plan.</h1>
              <p className="lp-lede">
                Enter your tasks, how long they take and what depends on what. Neo Project builds the schedule and
                gives you the Gantt chart, critical path, network diagram, WBS, resource plan and budget,
                ready to export into your report.
              </p>
              <div className="lp-actions">
                <button className="lp-btn lg" onClick={enterApp}>Start planning <Icon name="chevR" /></button>
                <button className="lp-btn lg ghost" onClick={openSample}>Try the sample project</button>
              </div>
              <p className="lp-note">Free · No sign-up · Nothing to install · Your project data stays on your computer</p>
            </div>
            <div className="lp-summary">
              <p className="lp-label" id="lp-glance">At a glance</p>
              <ul className="lp-stats" aria-labelledby="lp-glance">
                {STATS.map(([n, label]) => <li key={label}><b>{n}</b><span>{label}</span></li>)}
              </ul>
            </div>
          </div>
          <Preview sample={sample} />
        </section>

        <section className="lp-block" id="how">
          <div className="lp-head">
            <h2>How it works</h2>
            <p>Four steps take you from a list of tasks to a finished plan. You don’t need any project management software experience.</p>
          </div>
          <div className="lp-gantt">
            <div className="lp-g-row lp-g-head" aria-hidden="true">
              <span className="lp-g-id">ID</span><span>Task</span><span className="lp-g-pred">Pred.</span><span className="lp-g-time">Timeline</span>
            </div>
            <ol>
              {STEPS.map(([title, text], i) => (
                <li className="lp-g-row" key={title}>
                  <span className="lp-g-id">{i + 1}</span>
                  <div><h3>{title}</h3><p>{text}</p></div>
                  <span className="lp-g-pred">{i ? i : '–'}</span>
                  <span className="lp-g-time" aria-hidden="true"><i className="lp-g-bar" style={{ '--i': i } as CSSProperties} /></span>
                </li>
              ))}
              <li className="lp-g-row ms">
                <span className="lp-g-id">{STEPS.length + 1}</span>
                <div><h3>Plan ready</h3></div>
                <span className="lp-g-pred">{STEPS.length}</span>
                <span className="lp-g-time" aria-hidden="true"><i className="lp-g-ms" /></span>
              </li>
            </ol>
          </div>
        </section>

        <section className="lp-block" id="outputs">
          <div className="lp-head">
            <h2>What you get</h2>
            <p>Every chart is drawn from your plan and updates as you edit, so your diagrams always match your schedule.</p>
          </div>
          <ul className="lp-outputs">
            {OUTPUTS.map(o => <li key={o}><Icon name="check" />{o}</li>)}
          </ul>
        </section>

        <section className="lp-block" id="audience">
          <div className="lp-head">
            <h2>Who it’s for</h2>
            <p>Anyone who needs a proper project plan without buying desktop project management software.</p>
          </div>
          <div className="lp-cols">
            {AUDIENCE.map(([icon, title, text]) => <div key={title}><Icon name={icon} /><h3>{title}</h3><p>{text}</p></div>)}
          </div>
        </section>

        <section className="lp-block" id="included">
          <div className="lp-head">
            <h2>Features</h2>
            <p>The parts of desktop project software that courses and small teams actually use.</p>
          </div>
          <dl className="lp-spec">
            {SPEC.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </section>

        <section className="lp-block" id="files">
          <div className="lp-head">
            <h2>Your work stays with you</h2>
            <p>Neo Project has no server and no account. Here’s where your plans are kept. No analytics or tracking scripts are used; project data is never sent.</p>
          </div>
          <div className="lp-cols">
            <div><Icon name="save" /><h3>In your browser</h3><p>Every change is saved automatically on this device, so you can close the tab and continue later.</p></div>
            <div><Icon name="file" /><h3>In .neoproject files</h3><p>Save to a file on your computer. In Chrome and Edge, install the app and double-click a file to open it.</p></div>
            <div><Icon name="download" /><h3>In other tools</h3><p>Export CSV for spreadsheets, and PNG or SVG for your report.</p></div>
          </div>
        </section>

        <section className="lp-block" id="faq">
          <div className="lp-head">
            <h2>Questions</h2>
            <p>Short answers to what people usually ask first.</p>
          </div>
          <div className="lp-faq">
            {FAQ.map(([q, a]) => <details key={q}><summary>{q}<Icon name="chevD" /></summary><p>{a}</p></details>)}
          </div>
        </section>

        <section className="lp-end">
          <div>
            <h2>Ready to plan your project?</h2>
            <p>Open the app to continue your plan, or explore the sample project first.</p>
          </div>
          <div className="lp-actions">
            <button className="lp-btn lg" onClick={enterApp}>Start planning <Icon name="chevR" /></button>
            <button className="lp-btn lg ghost" onClick={openSample}>Try the sample project</button>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <span>Neo Project</span>
        <span className="lp-dot">·</span>
        <span>Free, browser-based project planning</span>
        <span className="lp-dot">·</span>
        <span>Open source under the <a href={REPO + '/blob/main/LICENSE'} target="_blank" rel="noreferrer">MIT License</a></span>
        <span className="lp-dot">·</span>
        <a href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a>
      </footer>
    </div>
  );
}
