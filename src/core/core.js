/*
 * Neo Project core: utilities, working-day calendar, project model and scheduler.
 * Scheduling uses the critical path method: a forward pass for early dates,
 * a backward pass for late dates, then total/free slack and the critical path.
 */
const OP = {};

/* ---------- utilities ---------- */

OP.util = (function () {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var fullYear = false;
  function setFullYear(on) { fullYear = !!on; }

  // Dates are handled as whole day numbers (days since 1970-01-01, UTC) to avoid timezone drift.
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    if (!m) return null;
    var dn = Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5);
    return iso(dn) === m[1] + '-' + m[2] + '-' + m[3] ? dn : null;
  }
  // Dates people type: 2026-01-05, 5 Jan 26, 5-Jan-2026, 05/01/2026 (day first). Returns a day number or null.
  function parseLoose(s) {
    s = String(s || '').trim();
    var iso0 = parseDate(s);
    if (iso0 != null && /^\d{4}-\d{2}-\d{2}$/.test(s)) return iso0;
    var m = /^(\d{1,2})[\s/.-]+([A-Za-z]{3,9}|\d{1,2})[\s/.-]+(\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    var mon = /^\d+$/.test(m[2]) ? +m[2] - 1 : MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(m[2].slice(0, 3).toLowerCase());
    if (mon < 0 || mon > 11) return null;
    var year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return parseDate(year + '-' + String(mon + 1).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0'));
  }
  function toDate(dn) { return new Date(dn * 864e5); }
  function iso(dn) { return toDate(dn).toISOString().slice(0, 10); }
  function weekday(dn) { return ((dn + 4) % 7 + 7) % 7; }
  function fmt(dn) {
    if (dn == null) return '';
    var d = toDate(dn);
    var y = String(d.getUTCFullYear());
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + (fullYear ? y : y.slice(2));
  }
  function fmtLong(dn) {
    if (dn == null) return '';
    var d = toDate(dn);
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function todayDn() {
    var n = new Date();
    return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 864e5);
  }
  function money(v, cur) {
    return (cur ? cur + ' ' : '') + Math.round(v || 0).toLocaleString();
  }
  function num(v, dp) {
    return (+v || 0).toLocaleString(undefined, { maximumFractionDigits: dp == null ? 1 : dp });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function download(name, content, type) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function slug(s) { return (s || 'project').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project'; }

  return {
    MONTHS: MONTHS, DAYS: DAYS, parseDate: parseDate, parseLoose: parseLoose, toDate: toDate, iso: iso, weekday: weekday,
    fmt: fmt, fmtLong: fmtLong, setFullYear: setFullYear, todayDn: todayDn, money: money, num: num, esc: esc, clone: clone,
    download: download, slug: slug
  };
})();

/* ---------- working-day calendar (work week, minus holidays and exceptions) ---------- */

// workDays: weekdays worked (0 = Sunday); exceptions: [{from, to, working}] date ranges that override the work week.
// Later exceptions win over earlier ones, like overlapping exceptions in MS Project.
OP.Calendar = function (startDn, holidays, workDays, exceptions) {
  var hol = {}, over = {};
  (holidays || []).forEach(function (h) { var d = OP.util.parseDate(h); if (d != null) hol[d] = true; });
  (exceptions || []).forEach(function (x) {
    var a = OP.util.parseDate(x.from), b = OP.util.parseDate(x.to || x.from);
    if (a == null || b == null) return;
    if (b < a) { var tmp = a; a = b; b = tmp; }
    for (var d = a; d <= b && d - a < 3660; d++) over[d] = x.working ? 1 : 2;
  });
  var wd = workDays && workDays.length ? workDays : [1, 2, 3, 4, 5];
  this.isWorking = function (dn) {
    if (over[dn]) return over[dn] === 1;
    return wd.indexOf(OP.util.weekday(dn)) >= 0 && !hol[dn];
  };
  var first = startDn;
  var guard = 0;
  while (!this.isWorking(first) && guard++ < 3660) first++;
  this.first = first;
  this.days = [first];
};
OP.Calendar.prototype.date = function (n) {
  n = Math.max(0, Math.floor(n));
  while (this.days.length <= n) {
    var d = this.days[this.days.length - 1] + 1;
    while (!this.isWorking(d)) d++;
    this.days.push(d);
  }
  return this.days[n];
};
// Index of the first working day on or after the given date.
OP.Calendar.prototype.indexOf = function (dn) {
  if (dn <= this.first) return 0;
  var hi = 1;
  while (this.date(hi) < dn) hi *= 2;
  var lo = 0;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (this.days[mid] < dn) lo = mid + 1; else hi = mid;
  }
  return lo;
};

// Early-finish index for a finish date: number of working days up to and including it.
OP.Calendar.prototype.finishIndex = function (dn) { return this.indexOf(dn + 1); };

/* ---------- project model ---------- */

OP.model = (function () {
  var LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];
  // Lag units: working days, percent of the predecessor's duration, elapsed (calendar) days.
  var LAG_UNITS = ['d', '%', 'ed'];
  var RES_TYPES = ['Manager', 'Full-time', 'Part-time', 'Supporter'];
  var RES_KINDS = ['Work', 'Material', 'Cost'];
  var CONSTRAINTS = {
    ASAP: 'As soon as possible', ALAP: 'As late as possible', SNET: 'Start no earlier than', SNLT: 'Start no later than',
    FNET: 'Finish no earlier than', FNLT: 'Finish no later than', MSO: 'Must start on', MFO: 'Must finish on'
  };
  var TASK_TYPES = { FixedUnits: 'Fixed units', FixedWork: 'Fixed work', FixedDuration: 'Fixed duration' };

  function blank() {
    var t = OP.util.todayDn();
    return {
      version: 2,
      name: 'Untitled project',
      organization: '',
      manager: '',
      status: 'Draft',
      issueDate: OP.util.iso(t),
      start: OP.util.iso(t),
      statusDate: '',
      budget: 0,
      currency: 'Rs.',
      hoursPerDay: 8,
      holidays: [],
      workDays: [1, 2, 3, 4, 5],
      exceptions: [],
      scheduleFrom: 'start',
      finishDate: '',
      criticalSlack: 0,
      customFields: [],
      baseline: null,
      nextUid: 1,
      tasks: [],
      resources: []
    };
  }

  var TASK_DEFAULTS = {
    name: '', level: 1, duration: 1, milestone: false, percent: 0, notes: '', preds: [], assignments: [],
    constraint: 'ASAP', constraintDate: '', deadline: '', type: 'FixedUnits', effortDriven: true, fixedCost: 0,
    actualStart: '', actualFinish: '', splits: [], levelDelay: 0, priority: 500, custom: {},
    mode: 'auto', active: true, manualStart: '', manualFinish: '', elapsed: false
  };
  var RES_DEFAULTS = {
    name: '', initials: '', role: '', type: 'Full-time', kind: 'Work', materialLabel: '', maxUnits: 100, rate: 0,
    costPerUse: 0, rates: [], workDays: [1, 2, 3, 4, 5], vacations: [], reportsTo: null
  };

  function fill(o, defs) {
    for (var k in defs) if (o[k] == null) o[k] = JSON.parse(JSON.stringify(defs[k]));
    return o;
  }

  function newTask(p, fields) {
    var t = fill({ uid: p.nextUid++ }, TASK_DEFAULTS);
    for (var k in fields) t[k] = fields[k];
    return t;
  }

  function newResource(p, fields) {
    var r = fill({ uid: p.nextUid++ }, RES_DEFAULTS);
    for (var k in fields) r[k] = fields[k];
    return r;
  }

  // Bring files from older versions up to date, fill missing fields and coerce every value to its expected type.
  function normalize(p) {
    var base = blank();
    for (var k in base) if (p[k] == null) p[k] = base[k];
    ['name', 'organization', 'manager', 'status', 'issueDate', 'start', 'statusDate', 'currency'].forEach(function (k) { p[k] = str(p[k]); });
    p.budget = Math.max(0, num(p.budget, 0));
    p.hoursPerDay = Math.max(1, Math.min(24, num(p.hoursPerDay, 8)));
    p.holidays = arr(p.holidays).map(str);
    p.workDays = arr(p.workDays).map(Number).filter(function (d, i, a) { return d >= 0 && d <= 6 && d === Math.floor(d) && a.indexOf(d) === i; }).sort();
    if (!p.workDays.length) p.workDays = [1, 2, 3, 4, 5];
    p.exceptions = arr(p.exceptions).filter(isObj).map(function (x) {
      return { name: str(x.name), from: str(x.from), to: str(x.to || x.from), working: !!x.working };
    }).filter(function (x) { return OP.util.parseDate(x.from) != null && OP.util.parseDate(x.to) != null; });
    // Older files kept holidays as a plain date list; they are calendar exceptions now.
    p.holidays.forEach(function (h) {
      if (OP.util.parseDate(h) != null && !p.exceptions.some(function (x) { return !x.working && x.from === h && x.to === h; })) {
        p.exceptions.push({ name: 'Holiday', from: h, to: h, working: false });
      }
    });
    p.holidays = [];
    p.scheduleFrom = p.scheduleFrom === 'finish' ? 'finish' : 'start';
    p.finishDate = str(p.finishDate);
    p.criticalSlack = Math.max(0, num(p.criticalSlack, 0));
    p.customFields = arr(p.customFields).filter(isObj).map(function (f) {
      return { id: str(f.id), name: str(f.name), type: f.type === 'number' ? 'number' : 'text' };
    });
    p.tasks = arr(p.tasks).filter(isObj);
    p.resources = arr(p.resources).filter(isObj);
    var maxUid = 0;
    p.tasks.concat(p.resources).forEach(function (o) { maxUid = Math.max(maxUid, uidOf(o)); });
    p.nextUid = Math.max(Math.floor(num(p.nextUid, 1)), maxUid + 1);
    [p.tasks, p.resources].forEach(function (list) {
      var seen = {};
      list.forEach(function (o) {
        var u = uidOf(o);
        if (!u || seen[u]) u = p.nextUid++;
        seen[u] = true;
        o.uid = u;
      });
    });
    p.tasks.forEach(function (t) {
      if (t.snet && !t.constraintDate) { t.constraint = 'SNET'; t.constraintDate = t.snet; }
      delete t.snet;
      fill(t, TASK_DEFAULTS);
      ['name', 'notes', 'constraintDate', 'deadline', 'actualStart', 'actualFinish'].forEach(function (k) { t[k] = str(t[k]); });
      t.level = Math.max(1, Math.floor(num(t.level, 1)));
      t.duration = Math.max(0, num(t.duration, 1));
      t.milestone = !!t.milestone;
      t.percent = Math.max(0, Math.min(100, num(t.percent, 0)));
      t.effortDriven = !!t.effortDriven;
      t.mode = t.mode === 'manual' ? 'manual' : 'auto';
      t.active = t.active !== false;
      t.elapsed = !!t.elapsed;
      t.manualStart = str(t.manualStart);
      t.manualFinish = str(t.manualFinish);
      t.fixedCost = num(t.fixedCost, 0);
      t.levelDelay = Math.max(0, num(t.levelDelay, 0));
      t.priority = Math.max(0, Math.min(1000, num(t.priority, 500)));
      if (!CONSTRAINTS[t.constraint]) t.constraint = 'ASAP';
      if (!TASK_TYPES[t.type]) t.type = 'FixedUnits';
      t.preds = arr(t.preds).filter(isObj).map(function (l) {
        var link = { uid: uidOf(l), type: LINK_TYPES.indexOf(l.type) >= 0 ? l.type : 'FS', lag: num(l.lag, 0) };
        if (l.unit === '%' || l.unit === 'ed') link.unit = l.unit;
        return link;
      }).filter(function (l) { return l.uid; });
      t.assignments = arr(t.assignments).filter(isObj).map(function (a) {
        return { res: uidOf({ uid: a.res }), units: Math.max(0, num(a.units, 0)) };
      }).filter(function (a) { return a.res; });
      t.splits = arr(t.splits).filter(isObj).map(function (x) { return { at: num(x.at, 0), gap: Math.max(0, num(x.gap, 0)) }; });
      var custom = {};
      if (isObj(t.custom)) for (var c in t.custom) {
        var v = t.custom[c];
        if (typeof v === 'string' || (typeof v === 'number' && isFinite(v))) custom[c] = v;
      }
      t.custom = custom;
    });
    p.resources.forEach(function (r) {
      fill(r, RES_DEFAULTS);
      ['name', 'initials', 'role', 'materialLabel'].forEach(function (k) { r[k] = str(r[k]); });
      if (RES_TYPES.indexOf(r.type) < 0) r.type = 'Full-time';
      if (RES_KINDS.indexOf(r.kind) < 0) r.kind = 'Work';
      r.maxUnits = Math.max(1, num(r.maxUnits, 100));
      r.rate = Math.max(0, num(r.rate, 0));
      r.costPerUse = Math.max(0, num(r.costPerUse, 0));
      r.rates = arr(r.rates).filter(isObj).map(function (e) { return { from: str(e.from), rate: Math.max(0, num(e.rate, 0)) }; });
      r.workDays = arr(r.workDays).map(Number).filter(function (d) { return d >= 0 && d <= 6 && d === Math.floor(d); });
      r.vacations = arr(r.vacations).map(str);
      r.reportsTo = uidOf({ uid: r.reportsTo }) || null;
    });
    if (!isObj(p.baseline) || !isObj(p.baseline.tasks)) p.baseline = null;
    else p.baseline.savedAt = str(p.baseline.savedAt);
    p.version = 2;
    normalizeLevels(p);
    return p;
  }

  function isObj(o) { return o != null && typeof o === 'object' && !Array.isArray(o); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return v == null ? '' : String(v); }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  function uidOf(o) { var u = +o.uid; return u > 0 && u === Math.floor(u) ? u : 0; }

  function isSummary(p, i) {
    return i + 1 < p.tasks.length && p.tasks[i + 1].level > p.tasks[i].level;
  }

  // Index one past the last descendant of task i.
  function subtreeEnd(p, i) {
    var lv = p.tasks[i].level, j = i + 1;
    while (j < p.tasks.length && p.tasks[j].level > lv) j++;
    return j;
  }

  function indexByUid(p) {
    var m = {};
    p.tasks.forEach(function (t, i) { m[t.uid] = i; });
    return m;
  }

  // "3, 5SS+2d, 7FF-1" -> [{uid, type, lag}] using row IDs (1-based) like MS Project.
  function parsePreds(p, text, selfUid) {
    var out = [], errors = [];
    String(text || '').split(/[,;]/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var m = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*(%|ed|ew|d|w|h)?)?$/i.exec(part);
      if (!m) { errors.push(part); return; }
      var t = p.tasks[+m[1] - 1];
      if (!t || t.uid === selfUid) { errors.push(part); return; }
      var mag = +m[4], u = (m[5] || 'd').toLowerCase(), unit = 'd';
      if (u === '%') unit = '%';
      else if (u === 'ed') unit = 'ed';
      else if (u === 'ew') { unit = 'ed'; mag *= 7; }
      else if (u === 'w') mag *= 5;
      else if (u === 'h') mag = Math.round(mag / (+p.hoursPerDay || 8) * 100) / 100;
      var lag = m[3] ? (m[3] === '-' ? -1 : 1) * mag : 0;
      var link = { uid: t.uid, type: (m[2] || 'FS').toUpperCase(), lag: lag };
      if (unit !== 'd') link.unit = unit;
      out.push(link);
    });
    return { preds: out, errors: errors };
  }

  function fmtLag(l) {
    return (l.lag > 0 ? '+' : '') + l.lag + (l.unit === '%' ? '%' : l.unit === 'ed' ? 'ed' : 'd');
  }
  function formatPreds(p, t, idx) {
    idx = idx || indexByUid(p);
    return t.preds.filter(function (l) { return idx[l.uid] != null; }).map(function (l) {
      var s = String(idx[l.uid] + 1);
      if (l.type !== 'FS' || l.lag) s += l.type;
      if (l.lag) s += fmtLag(l);
      return s;
    }).join(', ');
  }

  // "5", "5d", "2w", "16h", "30min", "1mo", "3ed", "2ew" -> { days, elapsed }.
  // Working units convert to working days (a week is 5 days, a month 20, an hour 1/hoursPerDay);
  // "ed"/"ew"/"emo" are elapsed (calendar) time, so the result is in calendar days. A trailing "?" (estimate) is accepted.
  function parseDurationEx(text, hpd) {
    var m = /^\s*(\d+(?:\.\d+)?)\s*(e?(?:d|day|days|w|wk|wks|week|weeks|mo|mon|month|months)|min|mins|minutes?|h|hr|hrs|hours?)?\s*\??\s*$/i.exec(String(text));
    if (!m) return null;
    var v = +m[1], u = (m[2] || 'd').toLowerCase(), elapsed = u[0] === 'e' && u !== 'e';
    if (elapsed) u = u.slice(1);
    if (/^mo/.test(u)) v *= elapsed ? 30 : 20;
    else if (u[0] === 'w') v *= elapsed ? 7 : 5;
    else if (/^mi/.test(u)) v /= 60 * (hpd || 8);
    else if (u[0] === 'h') v /= (hpd || 8);
    return { days: Math.round(v * 100) / 100, elapsed: elapsed };
  }

  // Working days. Elapsed input ("3ed") is read as its calendar-day count; callers that care about
  // the difference use parseDurationEx.
  function parseDuration(text, hpd) {
    var r = parseDurationEx(text, hpd);
    return r ? r.days : null;
  }

  function fmtDuration(d, elapsed) { return OP.util.num(d, 2) + (elapsed ? 'ed' : 'd'); }

  function removeTasks(p, uids) {
    var set = {};
    uids.forEach(function (u) { set[u] = true; });
    p.tasks = p.tasks.filter(function (t) { return !set[t.uid]; });
    p.tasks.forEach(function (t) { t.preds = t.preds.filter(function (l) { return !set[l.uid]; }); });
    normalizeLevels(p);
  }

  // Keep outline valid: first task level 1, no task more than one level deeper than its predecessor.
  function normalizeLevels(p) {
    var prev = 0;
    p.tasks.forEach(function (t) {
      t.level = Math.max(1, Math.min(t.level, prev + 1));
      prev = t.level;
    });
  }

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 3).toUpperCase();
  }

  // Standard hourly rate in force on a given day (rate table entries override the base rate from their date).
  function rateOn(res, dn) {
    var rate = +res.rate || 0;
    (res.rates || []).forEach(function (e) {
      var from = OP.util.parseDate(e.from);
      if (from != null && from <= dn) rate = +e.rate || 0;
    });
    return rate;
  }

  // Sum of work-resource units on a task, as a fraction (1 = one full-time person).
  function workUnits(p, t) {
    var byUid = {};
    p.resources.forEach(function (r) { byUid[r.uid] = r; });
    return t.assignments.reduce(function (a, x) {
      var r = byUid[x.res];
      return a + (r && r.kind === 'Work' ? x.units / 100 : 0);
    }, 0);
  }

  return {
    LINK_TYPES: LINK_TYPES, RES_TYPES: RES_TYPES, RES_KINDS: RES_KINDS, CONSTRAINTS: CONSTRAINTS, TASK_TYPES: TASK_TYPES,
    blank: blank, newTask: newTask, newResource: newResource, normalize: normalize,
    isSummary: isSummary, subtreeEnd: subtreeEnd, indexByUid: indexByUid, parsePreds: parsePreds,
    formatPreds: formatPreds, parseDuration: parseDuration, parseDurationEx: parseDurationEx, fmtDuration: fmtDuration, fmtLag: fmtLag,
    LAG_UNITS: LAG_UNITS,
    removeTasks: removeTasks, normalizeLevels: normalizeLevels, initials: initials, rateOn: rateOn, workUnits: workUnits
  };
})();

/* ---------- scheduler (critical path method) ---------- */

function scheduleCore(p, opts) {
  var U = OP.util, M = OP.model;
  var tasks = p.tasks, n = tasks.length;
  var startDn0 = opts && opts.startOverride != null ? opts.startOverride : (U.parseDate(p.start) || U.todayDn());
  var cal = new OP.Calendar(startDn0, p.holidays, p.workDays, p.exceptions);
  // Scheduling from the finish date pushes every task as late as its links allow.
  var alapAll = !!(opts && opts.alapAll);
  function isAlap(t) { return alapAll || t.constraint === 'ALAP'; }
  function act(i) { return tasks[i].active !== false; }
  var hpd = +p.hoursPerDay || 8;
  var idx = M.indexByUid(p);
  var resByUid = {};
  p.resources.forEach(function (r) { resByUid[r.uid] = r; });
  function startIdx(iso) { var d = U.parseDate(iso); return d == null ? null : cal.indexOf(d); }
  function finishIdx(iso) { var d = U.parseDate(iso); return d == null ? null : cal.finishIndex(d); }

  // Outline structure
  var rows = tasks.map(function (t, i) {
    return { task: t, i: i, id: i + 1, summary: M.isSummary(p, i), parent: -1, children: [], wbs: '', leaves: [] };
  });
  var stack = [], counters = [];
  rows.forEach(function (r) {
    var lv = r.task.level;
    while (stack.length && tasks[stack[stack.length - 1]].level >= lv) stack.pop();
    r.parent = stack.length ? stack[stack.length - 1] : -1;
    if (r.parent >= 0) rows[r.parent].children.push(r.i);
    counters.length = lv;
    counters[lv - 1] = (counters[lv - 1] || 0) + 1;
    r.wbs = counters.slice(0, lv).join('.');
    stack.push(r.i);
  });
  for (var i = n - 1; i >= 0; i--) {
    var r0 = rows[i];
    if (!r0.summary) r0.leaves = [i];
    else r0.children.forEach(function (c) { r0.leaves = r0.leaves.concat(rows[c].leaves); });
  }
  function isAncestor(a, b) {
    for (var q = rows[b].parent; q >= 0; q = rows[q].parent) if (q === a) return true;
    return false;
  }
  // Working-day duration. Elapsed tasks and manual tasks with both dates get theirs from the forward pass (effDur).
  var effDur = {};
  function baseDur(i) { return tasks[i].milestone ? 0 : Math.max(0, +tasks[i].duration || 0); }
  function dur(i) { return effDur[i] != null ? effDur[i] : baseDur(i); }
  // Working days that fall inside `ed` calendar days starting on working day index `es`.
  function elapsedWork(es, ed) {
    if (ed <= 0) return 0;
    var from = Math.floor(es);
    return Math.max(cal.indexOf(cal.date(from) + Math.ceil(ed)) - from, 1);
  }
  // Fix the task's working duration for a given start index.
  function spanFor(i, es) {
    var t = tasks[i];
    if (t.mode === 'manual' && t.manualStart && t.manualFinish) {
      var ms = startIdx(t.manualStart), mf = finishIdx(t.manualFinish);
      if (ms != null && mf != null) effDur[i] = Math.max(t.milestone ? 0 : 1, mf - ms);
    } else if (t.elapsed && !t.milestone) {
      effDur[i] = elapsedWork(es, baseDur(i));
    }
    return span(i);
  }
  function gaps(i) {
    var d = dur(i);
    return (tasks[i].splits || []).reduce(function (a, s) { return a + (s.at > 0 && s.at < d ? Math.max(0, +s.gap || 0) : 0); }, 0);
  }
  function span(i) { return dur(i) + gaps(i); }

  // Expand links on summary tasks into leaf-to-leaf edges.
  var edges = [], seen = {};
  rows.forEach(function (r) {
    r.task.preds.forEach(function (l) {
      var pi = idx[l.uid];
      if (pi == null || pi === r.i || isAncestor(pi, r.i) || isAncestor(r.i, pi)) return;
      rows[pi].leaves.forEach(function (a) {
        // An inactive task keeps its own dates but no longer drives its successors.
        if (!act(a)) return;
        r.leaves.forEach(function (b) {
          var unit = l.unit || 'd', key = a + '>' + b + l.type + l.lag + unit;
          if (a === b || seen[key]) return;
          seen[key] = true;
          // eff is the lag in working days; percent and elapsed lags are resolved in the forward pass.
          edges.push({ from: a, to: b, type: l.type, lag: +l.lag || 0, unit: unit, eff: unit === 'd' ? +l.lag || 0 : 0 });
        });
      });
    });
  });

  var leaves = rows.filter(function (r) { return !r.summary; }).map(function (r) { return r.i; });
  var preds = {}, succs = {}, indeg = {};
  leaves.forEach(function (i) { preds[i] = []; succs[i] = []; indeg[i] = 0; });
  edges.forEach(function (e) { preds[e.to].push(e); succs[e.from].push(e); indeg[e.to]++; });

  // Topological order (Kahn); anything left over is part of, or downstream of, a dependency loop.
  var order = [], queue = leaves.filter(function (i) { return indeg[i] === 0; });
  while (queue.length) {
    var v = queue.shift();
    order.push(v);
    succs[v].forEach(function (e) { if (--indeg[e.to] === 0) queue.push(e.to); });
  }
  var stuck = leaves.filter(function (i) { return indeg[i] > 0; });
  var cyclic = {};
  stuck.forEach(function (i) { cyclic[i] = true; order.push(i); });
  // Prune tasks that are merely downstream of a loop so only the loop itself is reported.
  var pruned = true, onLoop = {};
  stuck.forEach(function (i) { onLoop[i] = true; });
  while (pruned) {
    pruned = false;
    stuck.forEach(function (i) {
      if (onLoop[i] && !succs[i].some(function (e) { return onLoop[e.to]; })) { onLoop[i] = false; pruned = true; }
    });
  }
  var cycle = stuck.filter(function (i) { return onLoop[i]; });
  if (opts && opts.cycleOnly) return { cycle: cycle.map(function (i) { return i + 1; }) };

  // Earliest start allowed by one link, given the predecessor's dates (e.eff is the lag in working days).
  function linkStart(e, sp) {
    if (e.type === 'FS') return EF[e.from] + e.eff;
    if (e.type === 'SS') return ES[e.from] + e.eff;
    if (e.type === 'FF') return EF[e.from] + e.eff - sp;
    return ES[e.from] + e.eff - sp;
  }

  // Turn a percent or elapsed-day lag into working days, once the predecessor's dates are known.
  function resolveLag(e) {
    if (e.unit === 'd') return;
    var f = e.from, len = EF[f] - ES[f];
    if (e.unit === '%') { e.eff = e.lag / 100 * len; return; }
    var df = cal.date(Math.max(Math.ceil(EF[f]) - 1, 0)), ds = cal.date(ES[f]);
    if (e.type === 'FS') e.eff = cal.indexOf(df + 1 + e.lag) - EF[f];
    else if (e.type === 'SS') e.eff = cal.indexOf(ds + e.lag) - ES[f];
    else if (e.type === 'FF') e.eff = cal.finishIndex(df + e.lag) - EF[f];
    else e.eff = cal.finishIndex(ds + e.lag) - ES[f];
  }

  // Forward pass: early start / early finish in working-day units from project start.
  var ES = {}, EF = {}, conflict = {};
  order.forEach(function (i) {
    var t = tasks[i], es = 0, sp, cd, manual = t.mode === 'manual';
    var live = preds[i].filter(function (e) { return !(cyclic[i] && cyclic[e.from]) && ES[e.from] != null; });
    live.forEach(function (e) {
      resolveLag(e);
      if (e.type === 'FS' || e.type === 'SS') es = Math.max(es, linkStart(e, 0));
    });
    // FF and SF links depend on this task's own length, which for elapsed tasks depends on where it starts.
    sp = spanFor(i, es);
    for (var it = 0; it < 4; it++) {
      var es2 = es;
      live.forEach(function (e) { if (e.type === 'FF' || e.type === 'SF') es2 = Math.max(es2, linkStart(e, sp)); });
      if (Math.abs(es2 - es) < 1e-9) break;
      es = es2;
      sp = spanFor(i, es);
    }
    var fromLinks = es;
    if (manual) {
      // A manually scheduled task keeps the dates the user typed; links and constraints do not move it.
      if (t.manualStart && (cd = startIdx(t.manualStart)) != null) {
        es = cd;
        sp = spanFor(i, es);
        if (es < fromLinks - 1e-9) conflict[i] = 'This manually scheduled task starts before its predecessors allow';
      }
      es = Math.max(0, es);
    } else {
      if (t.constraintDate) {
        if (t.constraint === 'SNET' && (cd = startIdx(t.constraintDate)) != null) es = Math.max(es, cd);
        if (t.constraint === 'FNET' && (cd = finishIdx(t.constraintDate)) != null) es = Math.max(es, cd - sp);
        if (t.constraint === 'MSO' && (cd = startIdx(t.constraintDate)) != null) es = cd;
        if (t.constraint === 'MFO' && (cd = finishIdx(t.constraintDate)) != null) es = cd - sp;
      }
      if (es < fromLinks - 1e-9) conflict[i] = 'The ' + M.CONSTRAINTS[t.constraint] + ' date is earlier than its predecessors allow';
      es = Math.max(0, es) + (isAlap(t) ? 0 : +t.levelDelay || 0);
      if (t.elapsed) sp = spanFor(i, es);
    }
    if (t.actualStart && (cd = startIdx(t.actualStart)) != null) es = cd;
    ES[i] = es;
    EF[i] = es + sp;
    if (t.actualFinish && (cd = finishIdx(t.actualFinish)) != null) EF[i] = Math.max(es + (sp ? 1 : 0), cd);
  });

  var projEF = 0;
  leaves.forEach(function (i) { if (act(i) && EF[i] > projEF) projEF = EF[i]; });

  // Backward pass: late start / late finish (constraints and deadlines can only pull late dates earlier).
  var LS = {}, LF = {};
  for (var k = order.length - 1; k >= 0; k--) {
    var li = order[k], t2 = tasks[li], sp2 = EF[li] - ES[li], lf = projEF, cd2;
    succs[li].forEach(function (e) {
      if (LS[e.to] == null) return;
      var c;
      if (e.type === 'FS') c = LS[e.to] - e.eff;
      else if (e.type === 'SS') c = LS[e.to] - e.eff + sp2;
      else if (e.type === 'FF') c = LF[e.to] - e.eff;
      else c = LF[e.to] - e.eff + sp2;
      if (c < lf) lf = c;
    });
    if (t2.constraintDate) {
      if ((t2.constraint === 'SNLT' || t2.constraint === 'MSO') && (cd2 = startIdx(t2.constraintDate)) != null) lf = Math.min(lf, cd2 + sp2);
      if ((t2.constraint === 'FNLT' || t2.constraint === 'MFO') && (cd2 = finishIdx(t2.constraintDate)) != null) lf = Math.min(lf, cd2);
    }
    if (t2.deadline && (cd2 = finishIdx(t2.deadline)) != null) lf = Math.min(lf, cd2);
    LF[li] = lf;
    LS[li] = lf - sp2;
  }

  // As-late-as-possible tasks move right as far as their successors' early dates allow
  // (a leveling delay on an ALAP task pulls it back earlier instead).
  var ES0 = {};
  leaves.forEach(function (i) { ES0[i] = ES[i]; });
  for (var a = order.length - 1; a >= 0; a--) {
    var ai = order[a];
    if (!isAlap(tasks[ai]) || tasks[ai].mode === 'manual' || tasks[ai].actualStart || cyclic[ai]) continue;
    var asp = EF[ai] - ES[ai], limit = projEF;
    succs[ai].forEach(function (e) {
      var c;
      if (e.type === 'FS') c = ES[e.to] - e.eff;
      else if (e.type === 'SS') c = ES[e.to] - e.eff + asp;
      else if (e.type === 'FF') c = EF[e.to] - e.eff;
      else c = EF[e.to] - e.eff + asp;
      limit = Math.min(limit, c);
    });
    limit -= +tasks[ai].levelDelay || 0;
    if (limit > EF[ai]) { EF[ai] = limit; ES[ai] = limit - asp; }
  }

  // Free slack: how far a task can slip without delaying any successor.
  var FS = {};
  leaves.forEach(function (i) {
    var fs = projEF - EF[i];
    succs[i].forEach(function (e) {
      var c;
      if (e.type === 'FS') c = ES[e.to] - e.eff - EF[i];
      else if (e.type === 'SS') c = ES[e.to] - e.eff - ES[i];
      else if (e.type === 'FF') c = EF[e.to] - e.eff - EF[i];
      else c = EF[e.to] - e.eff - ES[i];
      fs = Math.min(fs, c);
    });
    FS[i] = Math.max(0, fs);
  });

  // Working-day segments actually worked (split tasks have gaps).
  function segments(i) {
    var d = dur(i), es = ES[i];
    if (tasks[i].actualFinish || !d) return [[es, es + Math.max(EF[i] - es, 0)]];
    var out = [], o = 0, t = es;
    (tasks[i].splits || []).filter(function (s) { return s.at > 0 && s.at < d; })
      .sort(function (x, y) { return x.at - y.at; })
      .forEach(function (s) {
        out.push([t, t + (s.at - o)]);
        t += (s.at - o) + (+s.gap || 0);
        o = s.at;
      });
    out.push([t, t + d - o]);
    return out;
  }

  // Resource loading and cost.
  var status = U.parseDate(p.statusDate) || U.todayDn();
  var statusIdx = cal.finishIndex(status);
  var load = {}, contrib = {}, agg = {}, dayCost = {};
  p.resources.forEach(function (res) { load[res.uid] = {}; contrib[res.uid] = {}; agg[res.uid] = { work: 0, cost: 0, qty: 0 }; });
  function addDayCost(day, v) { dayCost[day] = (dayCost[day] || 0) + v; }
  var base = p.baseline && p.baseline.tasks || null;
  rows.forEach(function (r) {
    var t = r.task;
    r.es = ES[r.i]; r.ef = EF[r.i]; r.ls = LS[r.i]; r.lf = LF[r.i]; r.freeSlack = FS[r.i]; r.esEarly = ES0[r.i];
    r.cost = 0; r.work = 0; r.cyclic = !!cyclic[r.i]; r.conflict = conflict[r.i] || '';
    r.material = {};
    r.inactive = !r.summary && !act(r.i);
    r.manual = !r.summary && t.mode === 'manual';
    r.elapsed = !r.summary && !!t.elapsed && !t.milestone;
    if (r.summary) return;
    r.segs = segments(r.i);
    if (r.inactive) {
      // Inactive tasks stay in the plan but carry no work, cost or progress.
      r.actualCost = 0; r.actualWork = 0; r.bcws = 0; r.bcwp = 0; r.acwp = 0; r.late = false;
      return;
    }
    var d = dur(r.i), flat = +t.fixedCost || 0;
    t.assignments.forEach(function (as) {
      var res = resByUid[as.res], ag = agg[as.res];
      if (!res) return;
      if (res.kind === 'Cost') { flat += +as.units || 0; ag.cost += +as.units || 0; return; }
      var once = +res.costPerUse || 0;
      if (res.kind === 'Material') {
        once += (+as.units || 0) * (+res.rate || 0);
        ag.qty += +as.units || 0;
        r.material[res.uid] = (r.material[res.uid] || 0) + (+as.units || 0);
      }
      flat += once;
      ag.cost += once;
      if (res.kind === 'Material') return;
      var perDay = as.units / 100 * hpd;
      r.work += perDay * d;
      ag.work += perDay * d;
      r.segs.forEach(function (sg) {
        for (var day = Math.floor(sg[0]); day < Math.ceil(sg[1]); day++) {
          var frac = Math.min(sg[1], day + 1) - Math.max(sg[0], day);
          if (frac <= 0) continue;
          load[res.uid][day] = (load[res.uid][day] || 0) + as.units;
          (contrib[res.uid][day] = contrib[res.uid][day] || []).push(r.i);
          var c = perDay * frac * M.rateOn(res, cal.date(day));
          r.cost += c;
          ag.cost += c;
          addDayCost(day, c);
        }
      });
    });
    r.cost += flat;
    // Fixed, per-use, material and cost-resource amounts are spread over the days actually worked.
    var worked = r.segs.reduce(function (a, sg) { return a + Math.max(0, sg[1] - sg[0]); }, 0);
    if (flat && !worked) addDayCost(Math.floor(r.es), flat);
    else if (flat) r.segs.forEach(function (sg) {
      for (var day = Math.floor(sg[0]); day < Math.ceil(sg[1]); day++) {
        var frac = Math.min(sg[1], day + 1) - Math.max(sg[0], day);
        if (frac > 0) addDayCost(day, flat * frac / worked);
      }
    });
    // Tracking: actual cost follows % complete; earned value needs a baseline.
    var pct = Math.max(0, Math.min(100, +t.percent || 0)) / 100;
    r.actualCost = r.cost * pct;
    r.actualWork = r.work * pct;
    var sp = r.ef - r.es;
    var expected = sp > 0 ? Math.max(0, Math.min(1, (statusIdx - r.es) / sp)) : (statusIdx >= r.es ? 1 : 0);
    r.late = !!(p.statusDate || base) && pct < expected - 1e-9;
    var b = base && base[t.uid];
    if (b) {
      var bes = startIdx(b.start), bef = b.duration ? finishIdx(b.finish) : bes, bsp = bef - bes;
      r.bcws = b.cost * (bsp > 0 ? Math.max(0, Math.min(1, (statusIdx - bes) / bsp)) : (statusIdx >= bes ? 1 : 0));
      r.bcwp = b.cost * pct;
    } else { r.bcws = 0; r.bcwp = 0; }
    r.acwp = r.actualCost;
  });

  // Roll up summaries (children come after parents, so walk backwards).
  for (var s = n - 1; s >= 0; s--) {
    var sr = rows[s];
    if (!sr.summary) continue;
    sr.es = Infinity; sr.ef = -Infinity; sr.ls = Infinity; sr.lf = -Infinity;
    sr.actualCost = 0; sr.actualWork = 0; sr.bcws = 0; sr.bcwp = 0; sr.acwp = 0; sr.late = false;
    sr.cost = +sr.task.fixedCost || 0;
    // A summary spans its active subtasks; if every subtask is inactive it spans them all.
    var activeKids = sr.children.filter(function (c) { return !rows[c].inactive; });
    sr.inactive = !activeKids.length;
    sr.manual = false; sr.elapsed = false;
    sr.children.forEach(function (c) {
      var cr = rows[c];
      if (!sr.inactive && cr.inactive) { sr.cost += cr.cost; return; }
      sr.es = Math.min(sr.es, cr.es); sr.ef = Math.max(sr.ef, cr.ef);
      sr.ls = Math.min(sr.ls, cr.ls); sr.lf = Math.max(sr.lf, cr.lf);
      sr.cost += cr.cost; sr.work += cr.work; sr.actualCost += cr.actualCost; sr.actualWork += cr.actualWork;
      sr.bcws += cr.bcws; sr.bcwp += cr.bcwp; sr.acwp += cr.acwp;
      sr.late = sr.late || cr.late;
    });
    sr.freeSlack = 0;
  }

  var totalCost = 0, totalWork = 0;
  rows.forEach(function (r) {
    var t = r.task;
    r.duration = r.summary ? r.ef - r.es : dur(r.i);
    // Duration as the user entered it: calendar days for elapsed tasks, working days otherwise.
    r.shown = r.elapsed ? +t.duration || 0 : r.duration;
    var slackLeaves = r.leaves.filter(act);
    if (!slackLeaves.length) slackLeaves = r.leaves;
    r.slack = r.summary ? Math.min.apply(null, slackLeaves.map(function (l) { return LS[l] - ES[l]; })) : r.ls - r.es;
    r.critical = !r.inactive && r.slack <= (+p.criticalSlack || 0) + 1e-9;
    r.milestone = !r.summary && r.duration === 0;
    r.startDn = r.milestone && r.es > 0 ? cal.date(Math.ceil(r.es) - 1) : cal.date(r.es);
    r.finishDn = r.ef - r.es > 0 ? cal.date(Math.ceil(r.ef) - 1) : r.startDn;
    r.percent = r.summary ? summaryPercent(r) : +t.percent || 0;
    if (!r.summary) { totalCost += r.cost; totalWork += r.work; } else totalCost += +t.fixedCost || 0;
    var dl = U.parseDate(t.deadline);
    r.missedDeadline = dl != null && r.finishDn > dl;
    var b = base && base[t.uid];
    r.base = b ? { startDn: U.parseDate(b.start), finishDn: U.parseDate(b.finish), duration: b.duration, cost: b.cost, work: b.work } : null;
    if (r.base) {
      r.startVar = cal.indexOf(r.startDn) - cal.indexOf(r.base.startDn);
      r.finishVar = cal.indexOf(r.finishDn) - cal.indexOf(r.base.finishDn);
      r.costVar = r.cost - r.base.cost;
      r.slipped = r.finishVar > 0;
    }
    r.names = t.assignments.map(function (a) {
      var res = resByUid[a.res];
      if (!res) return '';
      var label = res.initials || res.name;
      if (res.kind === 'Material') return label + ' [' + U.num(a.units) + (res.materialLabel ? ' ' + res.materialLabel : '') + ']';
      if (res.kind === 'Cost') return label;
      return label + (a.units !== 100 ? ' [' + a.units + '%]' : '');
    }).filter(Boolean).join(', ');
  });
  function summaryPercent(r) {
    var tot = 0, done = 0;
    r.leaves.filter(act).forEach(function (l) { var d = dur(l) || 0; tot += d; done += d * (+tasks[l].percent || 0) / 100; });
    return tot ? Math.round(done / tot * 100) : 0;
  }

  // Resource summary: peak allocation, availability (working days, vacations) and overallocation.
  var resStats = {};
  p.resources.forEach(function (res) {
    var vac = {};
    (res.vacations || []).forEach(function (v) { var d = U.parseDate(v); if (d != null) vac[d] = true; });
    var wd = res.workDays || [1, 2, 3, 4, 5];
    var capOn = function (day) {
      var dn = cal.date(day);
      return vac[dn] || wd.indexOf(U.weekday(dn)) < 0 ? 0 : res.maxUnits;
    };
    var peak = 0, overDays = [], L = load[res.uid], ag = agg[res.uid];
    for (var dd in L) {
      if (L[dd] > peak) peak = L[dd];
      if (L[dd] > capOn(+dd) + 1e-9) overDays.push(+dd);
    }
    resStats[res.uid] = { peak: peak, overDays: overDays.sort(function (x, y) { return x - y; }), over: overDays.length > 0, work: ag.work, cost: ag.cost, qty: ag.qty, capOn: capOn };
  });
  rows.forEach(function (r) {
    r.over = !r.summary && !r.inactive && r.task.assignments.some(function (a) {
      var st = resStats[a.res];
      return st && st.over && r.segs.some(function (sg) {
        return st.overDays.some(function (d) { return d >= Math.floor(sg[0]) && d < Math.ceil(sg[1]); });
      });
    });
  });

  // Project-level earned value.
  var ev = { bac: 0, bcws: 0, bcwp: 0, acwp: 0 };
  rows.forEach(function (r) {
    if (r.summary || r.inactive) return;
    ev.bcws += r.bcws; ev.bcwp += r.bcwp; ev.acwp += r.acwp;
    if (r.base) ev.bac += r.base.cost;
  });
  ev.sv = ev.bcwp - ev.bcws; ev.cv = ev.bcwp - ev.acwp;
  ev.spi = ev.bcws ? ev.bcwp / ev.bcws : null;
  ev.cpi = ev.acwp ? ev.bcwp / ev.acwp : null;
  ev.eac = ev.cpi ? ev.bac / ev.cpi : totalCost;
  ev.vac = ev.bac - ev.eac;

  var hasTasks = leaves.length > 0;
  return {
    rows: rows, edges: edges, cal: cal, load: load, contrib: contrib, resStats: resStats, ev: ev, dayCost: dayCost,
    cycle: cycle.map(function (i) { return i + 1; }),
    duration: projEF,
    statusDn: status,
    startDn: cal.date(0),
    finishDn: hasTasks ? (projEF > 0 ? cal.date(Math.ceil(projEF) - 1) : cal.date(0)) : cal.date(0),
    totalCost: totalCost, totalWork: totalWork,
    fromFinish: alapAll
  };
}

// Schedule from the project start, or, when the project is set to schedule from its finish date,
// find the start that makes the last task end on that date and push every task as late as it can go.
OP.schedule = function (p, opts) {
  opts = opts || {};
  var fin = p.scheduleFrom === 'finish' && !opts.cycleOnly ? OP.util.parseDate(p.finishDate) : null;
  if (fin == null) return scheduleCore(p, opts);
  var cal = new OP.Calendar(fin, p.holidays, p.workDays, p.exceptions);
  var last = fin, guard = 0;
  while (!cal.isWorking(last) && guard++ < 3660) last--;
  // Move a working day number by k working days (negative = earlier).
  function shift(dn, k) {
    var dir = k < 0 ? -1 : 1;
    for (k = Math.abs(k); k > 0; ) { dn += dir; if (cal.isWorking(dn)) k--; }
    return dn;
  }
  function workdaysBetween(a, b) { // signed working days from a to b
    var dir = b < a ? -1 : 1, n = 0;
    for (var d = a; d !== b; d += dir) { if (cal.isWorking(d + (dir > 0 ? 1 : 0))) n += dir; }
    return n;
  }
  var o = {};
  for (var key in opts) o[key] = opts[key];
  o.alapAll = true;
  // Start from a trial run to learn the plan's length, then correct for holidays and constraints.
  o.startOverride = last;
  var s = scheduleCore(p, o);
  var start = shift(last, -Math.max(Math.ceil(s.duration), 1) + 1);
  for (var pass = 0; pass < 6; pass++) {
    o.startOverride = start;
    s = scheduleCore(p, o);
    var diff = workdaysBetween(s.finishDn, last);
    if (!diff) break;
    start = shift(start, diff);
  }
  return s;
};

/* ---------- baseline and resource leveling ---------- */

OP.setBaseline = function (p) {
  var s = OP.schedule(p), U = OP.util, tasks = {};
  s.rows.forEach(function (r) {
    tasks[r.task.uid] = { start: U.iso(r.startDn), finish: U.iso(r.finishDn), duration: r.duration, cost: r.cost, work: r.work };
  });
  p.baseline = { savedAt: new Date().toISOString(), tasks: tasks };
};

// Serial resource leveling: place tasks one at a time (earliest start, then priority, then least slack)
// and delay each until every assigned person has capacity on all of its working days.
// Repeats the pass a few times because as-late-as-possible tasks can slide back into a conflict.
OP.level = function (p) {
  p.tasks.forEach(function (t) { t.levelDelay = 0; });
  var moved = {}, left = [], s2 = null;
  for (var pass = 0; pass < 4; pass++) {
    levelPass(p, moved, s2);
    s2 = OP.schedule(p);
    left = p.resources.filter(function (res) { return s2.resStats[res.uid].over; }).map(function (res) { return res.name || '(unnamed)'; });
    if (!left.length) break;
  }
  return { moved: Object.keys(moved).length, unresolved: left };
};

function levelPass(p, movedSet, s) {
  var resByUid = {}, usage = {}, placed = {}, n = 0;
  p.resources.forEach(function (r) { resByUid[r.uid] = r; usage[r.uid] = {}; });
  s = s || OP.schedule(p);
  var finishPlan = p.scheduleFrom === 'finish' && !!OP.util.parseDate(p.finishDate);
  var isAlap = function (t) { return finishPlan || t.constraint === 'ALAP'; };
  var leaves = s.rows.filter(function (r) { return !r.summary && !r.inactive; });
  var predsOf = {};
  s.edges.forEach(function (e) { (predsOf[e.to] = predsOf[e.to] || []).push(e.from); });
  while (n++ < leaves.length) {
    var ready = s.rows.filter(function (r) {
      return !r.summary && !r.inactive && !placed[r.i] && (predsOf[r.i] || []).every(function (q) { return placed[q]; });
    });
    if (!ready.length) ready = s.rows.filter(function (r) { return !r.summary && !r.inactive && !placed[r.i]; });
    if (!ready.length) break;
    ready.sort(function (a, b) {
      var la = isAlap(a.task) ? 1 : 0, lb = isAlap(b.task) ? 1 : 0;
      return (la - lb) || (a.es - b.es) || (b.task.priority - a.task.priority) || (a.slack - b.slack) || (a.id - b.id);
    });
    var r = ready[0], t = r.task;
    var work = t.assignments.filter(function (a) {
      var res = resByUid[a.res];
      return res && res.kind === 'Work' && a.units <= res.maxUnits;
    });
    var fixed = t.actualStart || t.constraint === 'MSO' || t.constraint === 'MFO' || t.percent > 0 || t.mode === 'manual';
    var rel = r.segs.map(function (sg) { return [sg[0] - r.es, sg[1] - r.es]; });
    var alap = isAlap(t), dir = alap ? -1 : 1, maxK = alap ? Math.floor(r.es - (r.esEarly || 0)) : 520;
    var fits = function (k) {
      return work.every(function (a) {
        var st = s.resStats[a.res], U = usage[a.res];
        return rel.every(function (sg) {
          for (var d = Math.floor(r.es + dir * k + sg[0]); d < Math.ceil(r.es + dir * k + sg[1]); d++) {
            if ((U[d] || 0) + a.units > st.capOn(d) + 1e-9) return false;
          }
          return true;
        });
      });
    };
    var k = 0;
    if (!fixed && work.length) while (k <= maxK && !fits(k)) k++;
    if (k > maxK) k = 0;
    if (k) { t.levelDelay = (+t.levelDelay || 0) + k; movedSet[t.uid] = true; }
    work.forEach(function (a) {
      rel.forEach(function (sg) {
        for (var d = Math.floor(r.es + dir * k + sg[0]); d < Math.ceil(r.es + dir * k + sg[1]); d++) usage[a.res][d] = (usage[a.res][d] || 0) + a.units;
      });
    });
    placed[r.i] = true;
    if (k) s = OP.schedule(p);
  }
}

export default OP;
