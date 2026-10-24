<div align="center">

<img src="public/assets/logo.png" alt="Neo Project" height="64">

**A free project planner that runs in the browser.**

Build a WBS, a Gantt chart, a critical-path network diagram, a resource plan and a budget without a paid licence.

![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)

</div>

---

## Table of contents

- [About](#about)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [Author](#author)
- [License](#license)

## About

Neo Project is a project management tool for students and small teams who need to plan a project with the standard techniques (WBS, Gantt chart, critical path method, resource allocation and budgeting) but don't have access to paid desktop software.

It runs entirely in the browser and has no server or account. Projects are saved on your own computer.

## Features

- **Gantt chart**: an outline of summary tasks and subtasks, FS/SS/FF/SF links with lag, milestones, constraints, deadlines, split tasks and a timeline strip. You can drag bars to move tasks, resize them or link them.
- **Critical path**: forward and backward passes that give ES, EF, LS, LF, total slack and free slack.
- **Diagrams**: a network diagram (activity on node), a WBS chart and a team org chart. Each one exports to PNG or SVG.
- **Resources**: work, material and cost resources, calendars, vacations, rate changes, a workload heatmap and resource leveling.
- **Tracking**: baselines, % complete, actual dates, a status date and earned value (SPI, CPI, EAC).
- **Budget and reports**: cost by work package and by resource, monthly and cumulative cost, and 10 ready-made reports.
- **Task board**: a Not started / In progress / Done board; dragging a card updates its % complete.
- **Getting started**: templates (final-year project, software sprint, event, research project) and a first-run checklist.
- **Files**: save to `.neoproject` files, open them by double-clicking once the app is installed, import task lists from Excel or CSV, and export Excel (.xlsx) and CSV.
- **Sharing and versions**: share a copy of a plan as a link (the plan travels inside the link, nothing is uploaded), and save named versions in the browser.
- **Offline**: once installed or visited, the app works without an internet connection.
- **Interface**: a tabbed toolbar that you can hide, keyboard shortcuts, undo and redo, and light and dark themes.

## Tech stack

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript 6 |
| State | Zustand 5 |
| Build | Vite 8 |
| Tests and lint | Vitest, ESLint |
| Scheduling and charts | Plain JavaScript modules rendering SVG (`src/core/`) |
| Storage | Browser localStorage, and the File System Access API for project files |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 18 or later

### Installation

```bash
git clone https://github.com/AbhishekAhirwar123/MS-Project-Clone.git
cd MS-Project-Clone
npm install
```

### Run in development

```bash
npm run dev        # http://localhost:5173
```

### Build for production

```bash
npm run build      # outputs to dist/
npm run lint       # ESLint
npm test           # Vitest
npm run preview    # serves dist/ at http://localhost:4173
```

### Deployment

`dist/` uses relative paths, so it can be hosted on any static host, such as GitHub Pages or Netlify. Opening `dist/index.html` directly from disk does not work in most browsers.

#### Vercel (automatic)

`.github/workflows/vercel.yml` deploys to [Vercel](https://vercel.com). Every push to `main` goes to production, and every pull request gets a preview URL.

One-time setup:

1. Create the Vercel project. Either import the repository at vercel.com/new, or run `npx vercel link` in the project folder.
2. Create a token at **vercel.com › Account Settings › Tokens**.
3. Find the IDs in `.vercel/project.json` (created by `vercel link`), or under **Project › Settings › General**.
4. In GitHub, go to **Settings › Secrets and variables › Actions** and add three repository secrets:
   - `VERCEL_TOKEN`: the token
   - `VERCEL_ORG_ID`: the `orgId`
   - `VERCEL_PROJECT_ID`: the `projectId`

If you imported the repository into Vercel, turn off Vercel's own Git deployments (**Project › Settings › Git**) so each push deploys only once.


## Usage

### Saving your work

- **Autosave**: every change is saved in the browser's localStorage. That copy exists only in the browser and computer you are using, and clearing your browser data deletes it.
- **Save** (Ctrl+S) writes an `.neoproject` file. In Chrome and Edge, the first save asks where to put the file, and later saves write back to that same file. **Save As** makes a copy. Other browsers download the file instead.
- **Open** loads an `.neoproject` file or an older `.json` project file.

Keep a project file for anything important.

### Opening files by double-clicking

In Chrome or Edge, install Neo Project as an app. After that, double-clicking an `.neoproject` file opens it in Neo Project.

1. Open Neo Project from an HTTPS address or from `localhost`.
2. Click the **Install** icon in the address bar, or choose **Cast, save and share › Install page as app** from the browser menu.
3. Double-click an `.neoproject` file. The first time, choose **Allow** when the browser asks whether Neo Project may open this file type.

### Toolbar

- The **Task**, **Resource**, **Report**, **Project** and **View** tabs each show a set of commands. **Format** appears when the Gantt chart is open.
- **File** opens the menu for new, open, save, export and print.
- **Hide toolbar** (or Ctrl+F1, or double-clicking a tab) collapses the toolbar to its tabs. While it is hidden, clicking a tab shows the commands over your work.

### Import and export

| Format | Support |
|---|---|
| Excel (.xlsx) | Export the task list with real dates |
| Excel / CSV | Import a task list: paste from a spreadsheet or choose a CSV file (File › Open) |
| CSV | Export the task list |
| Share link | A copy of the plan inside a link (File › Save, or the link button in the title bar) |
| PNG / SVG / PDF | Chart images, printing to PDF, and all 10 reports at once (Reports › Print all reports) |

### Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl+S | Save |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+F1 | Hide or show the toolbar |
| Alt+Shift+→ / ← | Indent or outdent the selected tasks |
| Insert | Insert a task |
| Delete | Delete the selected tasks |
| ↑ / ↓ | Move between rows while editing |

## Project structure

```
MS-Project-Clone/
├── public/
│   ├── assets/              logo, favicon and app icons
│   ├── manifest.webmanifest app install and .neoproject file handling
│   └── sw.js                offline support
├── src/
│   ├── core/                scheduling engine, file formats and CSV export, SVG charts, sample project
│   ├── components/          toolbar, title and status bars, File menu, dialogs, task details panel
│   ├── views/               Gantt, task board, diagrams, resource sheet, workload, budget, reports, landing page
│   ├── lib/                 task commands, grid columns and filters, file actions, templates, import,
│   │                        share links, versions, Excel writer, undo history (with tests)
│   ├── store.ts             app state, undo/redo, autosave
│   ├── App.tsx              layout and keyboard shortcuts
│   └── main.tsx             entry point
├── index.html
├── package.json
└── vite.config.ts
```

## Contributing

1. Fork the repository and create a branch: `git checkout -b feature/my-change`
2. Make your changes and check that `npm run lint`, `npm test` and `npm run build` pass.
3. Commit, push, and open a pull request.

## License

Neo Project is released under the [MIT License](LICENSE).
