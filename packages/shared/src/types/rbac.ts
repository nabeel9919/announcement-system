export type UserRole = 'operator' | 'supervisor' | 'admin'

/**
 * Role capabilities:
 *
 *  operator   — call / recall / serve / no-show / skip tickets, mute audio
 *  supervisor — + broadcast, view analytics, day summary, manage shifts
 *  admin      — + settings, categories, windows, media, printer, reset day
 */
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  operator: [
    'tickets:call',
    'tickets:recall',
    'tickets:serve',
    'tickets:noShow',
    'tickets:skip',
    'audio:mute',
  ],
  supervisor: [
    'tickets:call',
    'tickets:recall',
    'tickets:serve',
    'tickets:noShow',
    'tickets:skip',
    'audio:mute',
    'display:broadcast',
    'analytics:view',
    'summary:view',
    'shifts:manage',
  ],
  admin: [
    'tickets:call',
    'tickets:recall',
    'tickets:serve',
    'tickets:noShow',
    'tickets:skip',
    'audio:mute',
    'display:broadcast',
    'analytics:view',
    'summary:view',
    'shifts:manage',
    'settings:edit',
    'categories:edit',
    'windows:edit',
    'media:edit',
    'printer:config',
    'day:reset',
    'users:manage',
  ],
}

export function hasPermission(role: UserRole, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export interface SystemUser {
  id: string
  username: string
  displayName: string
  role: UserRole
  windowId?: string   // which service window this user is assigned to (optional)
  isActive: boolean
  createdAt: string
  lastLoginAt?: string
}
