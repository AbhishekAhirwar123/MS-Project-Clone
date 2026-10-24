import type { Project } from '../types';

// Named versions are full copies of a plan kept in this browser, newest first.
export interface Version { id: string; name: string; project: string; at: string; json: string }

const KEY = 'neoproject.versions', MAX = 30;

export function listVersions(): Version[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter(v => v && typeof v.json === 'string') : [];
  } catch {
    return [];
  }
}

function store(list: Version[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

// Returns an error message when the version could not be saved.
export function saveVersion(name: string, p: Project): string | null {
  const v: Version = { id: Date.now().toString(36), name: name.trim() || 'Version', project: p.name, at: new Date().toISOString(), json: JSON.stringify(p) };
  try {
    store([v, ...listVersions()].slice(0, MAX));
    return null;
  } catch {
    return 'Browser storage is full or unavailable. Delete some versions, or save a project file instead.';
  }
}

export function deleteVersion(id: string) {
  try { store(listVersions().filter(v => v.id !== id)); } catch { /* storage unavailable */ }
}
