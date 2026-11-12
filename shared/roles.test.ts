import { describe, expect, it } from 'vitest';
import { canCreateProject, canEdit, canManage, canManageUsers, projectAccess, type ProjectAccessInfo } from './roles';

const project: ProjectAccessInfo = {
  ownerId: 'pm1',
  members: [{ userId: 'tm1', access: 'edit' }, { userId: 'tm2', access: 'view' }, { userId: 'v1', access: 'edit' }]
};

describe('projectAccess', () => {
  it('gives admins and the owner full control', () => {
    expect(projectAccess({ id: 'a1', role: 'admin' }, project)).toBe('owner');
    expect(projectAccess({ id: 'pm1', role: 'project_manager' }, project)).toBe('owner');
  });

  it('gives members the access they were shared with', () => {
    expect(projectAccess({ id: 'tm1', role: 'team_member' }, project)).toBe('edit');
    expect(projectAccess({ id: 'tm2', role: 'team_member' }, project)).toBe('view');
  });

  it('keeps viewers read-only even when shared with edit access', () => {
    expect(projectAccess({ id: 'v1', role: 'viewer' }, project)).toBe('view');
  });

  it('hides the project from everyone else, including other project managers', () => {
    expect(projectAccess({ id: 'pm2', role: 'project_manager' }, project)).toBeNull();
    expect(projectAccess({ id: 'x', role: 'team_member' }, project)).toBeNull();
  });
});

describe('role permissions', () => {
  it('lets only admins and project managers create projects', () => {
    expect(canCreateProject('admin')).toBe(true);
    expect(canCreateProject('project_manager')).toBe(true);
    expect(canCreateProject('team_member')).toBe(false);
    expect(canCreateProject('viewer')).toBe(false);
  });

  it('lets only admins manage users', () => {
    expect(canManageUsers('admin')).toBe(true);
    expect(canManageUsers('project_manager')).toBe(false);
  });

  it('maps access to edit and manage rights', () => {
    expect([canEdit('owner'), canEdit('edit'), canEdit('view'), canEdit(null)]).toEqual([true, true, false, false]);
    expect([canManage('owner'), canManage('edit'), canManage('view')]).toEqual([true, false, false]);
  });
});
