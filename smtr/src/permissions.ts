export type Role = 'director' | 'manager' | 'agent';
export type ModuleId =
  | 'dashboard' | 'stocks' | 'transfers' | 'sales' | 'debts'
  | 'cases' | 'cash' | 'inventory' | 'approvals' | 'reports'
  | 'users' | 'audit';

const NAV_PERMISSIONS: Record<Role, readonly ModuleId[]> = {
  director: [
    'dashboard', 'stocks', 'transfers', 'sales', 'debts',
    'cases', 'cash', 'inventory', 'approvals', 'reports', 'users', 'audit',
  ],
  manager: [
    'dashboard', 'stocks', 'transfers', 'sales', 'debts',
    'cases', 'cash', 'inventory', 'approvals', 'reports',
  ],
  agent: ['dashboard', 'sales', 'stocks', 'transfers', 'debts', 'cash', 'cases'],
};

export function canView(role: Role, module: ModuleId): boolean {
  return NAV_PERMISSIONS[role].includes(module);
}
export function roleModules(role: Role): readonly ModuleId[] {
  return NAV_PERMISSIONS[role];
}
export function isRole(value: unknown): value is Role {
  return value === 'director' || value === 'manager' || value === 'agent';
}
export function isModule(value: unknown): value is ModuleId {
  return [
    'dashboard', 'stocks', 'transfers', 'sales', 'debts',
    'cases', 'cash', 'inventory', 'approvals', 'reports', 'users', 'audit',
  ].includes(String(value));
}
