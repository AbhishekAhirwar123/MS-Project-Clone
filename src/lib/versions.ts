import type { Project } from '../types';
import { api, type VersionInfo } from './api';

// Named versions are full copies of a plan, stored with the project in the database (newest first, up to 50).

export async function listVersions(projectId: string): Promise<VersionInfo[]> {
  return (await api<{ versions: VersionInfo[] }>('GET', '/projects/' + projectId + '/versions')).versions;
}

export async function saveVersion(projectId: string, name: string, p: Project): Promise<VersionInfo> {
  return (await api<{ version: VersionInfo }>('POST', '/projects/' + projectId + '/versions', { name: name.trim() || 'Version', data: p })).version;
}

export async function getVersion(projectId: string, id: string): Promise<Project> {
  return (await api<{ data: Project }>('GET', '/projects/' + projectId + '/versions/' + id)).data;
}

export async function deleteVersion(projectId: string, id: string): Promise<void> {
  await api('DELETE', '/projects/' + projectId + '/versions/' + id);
}
