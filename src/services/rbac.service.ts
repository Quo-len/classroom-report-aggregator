import { z } from 'zod';
import { FastifyInstance } from 'fastify';
import { database } from './database.service';

export const ROLES = ['admin', 'editor', 'viewer', 'disabled'] as const;
export type Role = typeof ROLES[number];

/**
 * Permissions always apply to the signed-in user's own rows (every query is scoped by user_id).
 * Only `users:manage` reaches across accounts, and it exposes account metadata, never tokens or report data.
 */
const PERMISSIONS = {
  'account:self': ['admin', 'editor', 'viewer'],
  'report:read': ['admin', 'editor', 'viewer'],
  'settings:write': ['admin', 'editor'],
  'workflow:run': ['admin', 'editor'],
  'users:manage': ['admin'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

declare module 'fastify' {
  interface FastifyContextConfig { permission?: Permission; }
}

export function can(role: string | undefined, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role || '');
}

export function permissionsFor(role: string): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter(permission => can(role, permission));
}

export async function audit(actorId: string | null, targetId: string | null, action: string, detail: Record<string, unknown> = {}) {
  await database().query('INSERT INTO bird.audit_log (actor_id, target_id, action, detail) VALUES ($1, $2, $3, $4)',
    [actorId, targetId, action, detail]);
}

export function registerAdmin(server: FastifyInstance) {
  const manage = { config: { permission: 'users:manage' as const } };

  server.get('/api/admin/users', manage, async () => {
    const users = await database().query(`SELECT u.id, u.email, u.name, u.role, u.created_at, (u.tokens IS NOT NULL) AS connected,
        (s.user_id IS NOT NULL) AS configured, COALESCE(s.automation_enabled, false) AS automation_enabled,
        (SELECT max(r.started_at) FROM bird.runs r WHERE r.user_id = u.id) AS last_run_at
      FROM bird.users u LEFT JOIN bird.settings s ON s.user_id = u.id ORDER BY u.created_at, u.id`);
    const events = await database().query(`SELECT a.action, a.detail, a.created_at, actor.email AS actor, target.email AS target
      FROM bird.audit_log a LEFT JOIN bird.users actor ON actor.id = a.actor_id LEFT JOIN bird.users target ON target.id = a.target_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT 20`);
    return { users: users.rows, audit: events.rows };
  });

  server.put<{ Params: { id: string } }>('/api/admin/users/:id/role', manage, async (request, reply) => {
    const parsed = z.object({ role: z.enum(ROLES) }).strict().safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) {
      return reply.code(400).send({ error: 'Невідомий користувач або роль.' });
    }
    const actorId = request.accountSession!.user_id;
    const targetId = request.params.id;
    const { role } = parsed.data;
    if (targetId === actorId) return reply.code(400).send({ error: 'Власну роль може змінити лише інший адміністратор.' });

    const client = await database().connect();
    try {
      await client.query('BEGIN');
      // Lock all administrators so concurrent demotions cannot remove the last one.
      await client.query("SELECT id FROM bird.users WHERE role = 'admin' FOR UPDATE");
      const target = await client.query('SELECT role FROM bird.users WHERE id = $1 FOR UPDATE', [targetId]);
      if (!target.rows[0]) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Користувача не знайдено.' }); }
      const previous = target.rows[0].role;
      if (previous === 'admin' && role !== 'admin') {
        const admins = await client.query("SELECT count(*)::int AS count FROM bird.users WHERE role = 'admin'");
        if (admins.rows[0].count <= 1) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Має залишитися хоча б один адміністратор.' }); }
      }
      await client.query('UPDATE bird.users SET role = $2 WHERE id = $1', [targetId, role]);
      // Roles that cannot run workflows must not keep the scheduler running on their behalf.
      if (!can(role, 'workflow:run')) await client.query('UPDATE bird.settings SET automation_enabled = false WHERE user_id = $1', [targetId]);
      if (role === 'disabled') await client.query('DELETE FROM bird.sessions WHERE user_id = $1', [targetId]);
      await client.query('INSERT INTO bird.audit_log (actor_id, target_id, action, detail) VALUES ($1, $2, $3, $4)',
        [actorId, targetId, 'role.changed', { from: previous, to: role }]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    return { ok: true };
  });
}
