import { and, eq, isNull, notInArray } from 'drizzle-orm';
import { LEAD_CONVERTED, LEAD_LOST } from '@mms/shared';
import type { Tx } from '../../db/client.ts';
import {
  activities,
  auditLog,
  companies,
  contacts,
  leads,
  projects,
  tickets,
  users,
} from '../../db/schema/index.ts';
import { logSystemActivity } from '../activities/service.ts';
import { recordAudit, type Actor } from '../audit.ts';

/**
 * Permanently deletes a user, keeping the CRM's history readable (Admin action; the caller has
 * checked who may do it). In one transaction:
 *   1. their name is saved on every timeline entry and audit log entry they made, so history
 *      still says who did it once author_user_id / actor_user_id become null;
 *   2. what they own or are assigned becomes Unassigned: leads, tickets, open tasks, projects
 *      (sales person), contacts, companies, the people they manage. Each open lead and open
 *      ticket gets a timeline note saying so;
 *   3. the user row is deleted. Every other reference to users is ON DELETE SET NULL; only their
 *      own settings (drafts, signature, saved views, Gmail connection) go with them.
 * The audit log keeps a 'purge' entry with who they were.
 */
export async function deleteUser(
  tx: Tx,
  actor: Actor,
  user: { id: string; name: string; email: string; isActive: boolean },
  roleKey: string,
) {
  // 1. Their name stays in history.
  await tx
    .update(activities)
    .set({ authorNameSnapshot: user.name })
    .where(eq(activities.authorUserId, user.id));
  await tx
    .update(auditLog)
    .set({ actorNameSnapshot: user.name })
    .where(eq(auditLog.actorUserId, user.id));

  // 2. Unassign, with a note on what was still open.
  const openLeads = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.ownerUserId, user.id),
        isNull(leads.deletedAt),
        notInArray(leads.status, [LEAD_CONVERTED, LEAD_LOST]),
      ),
    );
  const openTickets = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.assignedUserId, user.id), isNull(tickets.closedAt)));
  await tx.update(leads).set({ ownerUserId: null }).where(eq(leads.ownerUserId, user.id));
  await tx.update(tickets).set({ assignedUserId: null }).where(eq(tickets.assignedUserId, user.id));
  await tx
    .update(activities)
    .set({ assignedUserId: null })
    .where(eq(activities.assignedUserId, user.id));
  await tx.update(projects).set({ salesUserId: null }).where(eq(projects.salesUserId, user.id));
  await tx.update(contacts).set({ ownerUserId: null }).where(eq(contacts.ownerUserId, user.id));
  await tx.update(companies).set({ ownerUserId: null }).where(eq(companies.ownerUserId, user.id));
  await tx.update(users).set({ managerUserId: null }).where(eq(users.managerUserId, user.id));
  const note = `Now Unassigned: ${user.name} was removed from the CRM`;
  for (const [entityType, rows] of [
    ['lead', openLeads],
    ['ticket', openTickets],
  ] as const) {
    for (const row of rows) {
      await logSystemActivity(tx, {
        entityType,
        entityId: row.id,
        authorUserId: null,
        subject: note,
        metadata: { field: 'owner', from: user.id, fromName: user.name, to: null },
      });
    }
  }

  // 3. The user goes; the audit log remembers who they were.
  await tx.delete(users).where(eq(users.id, user.id));
  await recordAudit(tx, actor, {
    action: 'purge',
    entityType: 'user',
    entityId: user.id,
    before: { email: user.email, name: user.name, role: roleKey, isActive: user.isActive },
    after: {
      leadsUnassigned: openLeads.length,
      ticketsUnassigned: openTickets.length,
    },
  });
  return { leadsUnassigned: openLeads.length, ticketsUnassigned: openTickets.length };
}
