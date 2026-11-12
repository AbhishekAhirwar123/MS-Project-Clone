// Roles and permission rules, shared by the API (which enforces them) and the UI (which hides what you can't do).
//
// Account roles:
//   admin            Manages user accounts. Full control of every project.
//   project_manager  Creates projects and controls the ones they own: edit, share, delete.
//   team_member      Opens projects shared with them; edits them when shared with edit access.
//   viewer           Read-only access to projects shared with them, whatever the share says.
//
// Project access, worked out per user per project:
//   owner  edit + manage sharing + delete   (the project's owner, and every admin)
//   edit   change the plan and save versions
//   view   read-only

export const ROLES = ['admin', 'project_manager', 'team_member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  project_manager: 'Project manager',
  team_member: 'Team member',
  viewer: 'Viewer'
};

export type ShareAccess = 'edit' | 'view';
export type Access = 'owner' | ShareAccess;

export const ACCESS_LABELS: Record<Access, string> = { owner: 'Owner', edit: 'Can edit', view: 'Can view' };

export interface Member { userId: string; access: ShareAccess }
export interface ProjectAccessInfo { ownerId: string; members: Member[] }
export interface Actor { id: string; role: Role }

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

// The access a user has to a project, or null when they cannot see it at all.
export function projectAccess(user: Actor, p: ProjectAccessInfo): Access | null {
  if (user.role === 'admin' || p.ownerId === user.id) return 'owner';
  const m = p.members.find(x => x.userId === user.id);
  if (!m) return null;
  return user.role === 'viewer' ? 'view' : m.access;
}

export const canCreateProject = (role: Role) => role === 'admin' || role === 'project_manager';
export const canOwnProject = canCreateProject;
export const canManageUsers = (role: Role) => role === 'admin';
export const canEdit = (a: Access | null) => a === 'owner' || a === 'edit';
export const canManage = (a: Access | null) => a === 'owner';

// The most a member with this account role can be given on a shared project.
export const maxShareAccess = (role: Role): ShareAccess => (role === 'viewer' ? 'view' : 'edit');
