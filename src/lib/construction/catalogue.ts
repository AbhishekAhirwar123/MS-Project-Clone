import type { CxUnit, LinkType } from '../../types';

/*
 * Built-in construction activity catalogue (a planning starter, not a construction method).
 * Plans copy what they use when they are generated, so changing this file never changes an existing plan.
 * Bump CATALOGUE_VERSION when activities or rules change.
 */

export const CATALOGUE_KEY = 'construction-building';
export const CATALOGUE_VERSION = 1;

export type GroupKey = 'structure' | 'masonry' | 'finishes' | 'fittings';
export const GROUPS: readonly { key: GroupKey; name: string }[] = Object.freeze([
  { key: 'structure', name: 'Structure' },
  { key: 'masonry', name: 'Masonry and concealed services' },
  { key: 'finishes', name: 'Plaster and finishes' },
  { key: 'fittings', name: 'Final fittings and handover' }
]);

export type Dimension = 'area' | 'volume' | 'length' | 'count';
export const UNITS: Readonly<Record<CxUnit, { label: string; dim: Dimension }>> = Object.freeze({
  sqft: { label: 'sq ft', dim: 'area' },
  sqm: { label: 'sq m', dim: 'area' },
  cum: { label: 'cu m', dim: 'volume' },
  cft: { label: 'cu ft', dim: 'volume' },
  rft: { label: 'running ft', dim: 'length' },
  rm: { label: 'running m', dim: 'length' },
  nos: { label: 'nos', dim: 'count' }
});
export const isUnit = (u: unknown): u is CxUnit => typeof u === 'string' && u in UNITS;
export const unitLabel = (u: CxUnit | '' | undefined) => (u && UNITS[u] ? UNITS[u].label : '');

export interface CatalogueActivity {
  key: string;            // stable; plans and dependency rules refer to this, never to the display name
  name: string;
  group: GroupKey;
  unit: CxUnit | '';      // a suggestion; quantities are never filled in for you
  milestone: boolean;
  // floors: offered on basements, ground and numbered floors · external: on building-level works (façade)
  // auto: added wherever concealed services are selected in a location
  scope: 'floors' | 'external' | 'auto';
  defaultOn: boolean;
}

const A = (key: string, name: string, group: GroupKey, unit: CxUnit | '', scope: CatalogueActivity['scope'] = 'floors', extra: Partial<CatalogueActivity> = {}): CatalogueActivity =>
  Object.freeze({ key, name, group, unit, milestone: false, scope, defaultOn: true, ...extra });

export const RELEASE_KEY = 'services_release';
export const SERVICE_KEYS: readonly string[] = Object.freeze(['elec_conduit', 'plumbing_concealed', 'ac_pipeline']);

export const CATALOGUE: readonly CatalogueActivity[] = Object.freeze([
  A('columns', 'Columns', 'structure', 'cum'),
  A('slab_formwork', 'Slab shuttering and reinforcement', 'structure', 'sqft'),
  A('slab_concrete', 'Slab concreting', 'structure', 'cum'),
  A('brickwork', 'Brickwork', 'masonry', 'sqft'),
  A('elec_conduit', 'Electrical wall conduit', 'masonry', 'rft'),
  A('plumbing_concealed', 'Concealed plumbing', 'masonry', 'rft'),
  A('ac_pipeline', 'AC pipeline', 'masonry', 'rft'),
  A(RELEASE_KEY, 'Concealed services review/release', 'masonry', '', 'auto', { milestone: true }),
  A('inside_plaster', 'Inside plaster', 'finishes', 'sqft'),
  A('outside_plaster', 'Outside plaster', 'finishes', 'sqft', 'external'),
  A('putty_1', 'Putty — first coat', 'finishes', 'sqft'),
  A('tiles', 'Tiles', 'finishes', 'sqft'),
  A('outer_paint', 'Outer texture and paint', 'finishes', 'sqft', 'external'),
  A('elec_wiring', 'Electrical wiring', 'fittings', 'rft'),
  A('doors_windows', 'Doors and windows', 'fittings', 'nos'),
  A('putty_2', 'Putty — second coat', 'finishes', 'sqft'),
  A('paint_1', 'Paint — first coat', 'finishes', 'sqft'),
  A('elec_fittings', 'Electrical switchboards, MCB fittings and testing', 'fittings', 'nos'),
  A('cp_fittings', 'Plumbing CP and sanitary fittings', 'fittings', 'nos'),
  A('paint_final', 'Paint — final coat', 'finishes', 'sqft'),
  A('handover', 'Handover', 'fittings', '', 'floors', { milestone: true, defaultOn: false })
]);

export interface Rule { from: string; to: string; type: LinkType; lag: number; reason: string }

// Proposed relationships between activity types in the same location. Deliberately incomplete: anything not
// listed here is left for the project engineer (no structural sequence, curing period or release rule is assumed).
const R = (from: string, to: string, reason: string): Rule => Object.freeze({ from, to, type: 'FS' as LinkType, lag: 0, reason });
export const RULES: readonly Rule[] = Object.freeze([
  R('slab_formwork', 'slab_concrete', 'Concreting needs the shuttering and reinforcement in place.'),
  R('brickwork', 'elec_conduit', 'Wall conduit is chased into completed brickwork.'),
  R('brickwork', 'plumbing_concealed', 'Concealed plumbing runs in completed brickwork.'),
  R('brickwork', 'ac_pipeline', 'AC pipework runs in completed brickwork.'),
  R('elec_conduit', RELEASE_KEY, 'Concealed conduit is reviewed before it is covered.'),
  R('plumbing_concealed', RELEASE_KEY, 'Concealed plumbing is reviewed before it is covered.'),
  R('ac_pipeline', RELEASE_KEY, 'Concealed AC pipework is reviewed before it is covered.'),
  R(RELEASE_KEY, 'inside_plaster', 'Plaster covers the concealed services, so it waits for their review/release.'),
  R('inside_plaster', 'putty_1', 'Putty goes on finished plaster.'),
  R('outside_plaster', 'outer_paint', 'Texture and paint go on finished outside plaster.'),
  R('putty_1', 'putty_2', 'Second putty coat follows the first.'),
  R('putty_2', 'paint_1', 'First paint coat follows the second putty coat.'),
  R('elec_conduit', 'elec_wiring', 'Wiring is pulled through the installed conduit.'),
  R('elec_wiring', 'elec_fittings', 'Switchboards and MCBs are fitted and tested after wiring.'),
  R('tiles', 'cp_fittings', 'CP and sanitary fittings are fixed after tiling.')
]);
