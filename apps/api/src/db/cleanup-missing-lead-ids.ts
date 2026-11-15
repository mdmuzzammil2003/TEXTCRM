import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { loadConfig } from '../config.ts';
import { createStorage, type Storage } from '../storage/storage.ts';
import { createDb, type Db, type Tx } from './client.ts';
import {
  activities,
  emailDrafts,
  emailMessages,
  files,
  leads,
  projects,
  smsMessages,
  tickets,
} from './schema/index.ts';
import { recordAudit, type SystemActor } from '../modules/audit.ts';
import { linkedTo, purgeRecords, removeStoredFiles } from '../modules/purge.ts';

/**
 * One-off clean-up for the Lead ID rule (a lead needs a Lead ID to become a project, and the
 * Project ID is that Lead ID): permanently deletes every lead without a Lead ID and every project
 * whose lead has none, with their timeline entries, files and drafts.
 *
 *   node src/db/cleanup-missing-lead-ids.ts                        list only, changes nothing
 *   node src/db/cleanup-missing-lead-ids.ts --commit --expect <fp>   delete exactly that list
 *
 * The list ends with a fingerprint of the records on it; --commit refuses unless the records
 * found then still have that fingerprint, so what is deleted is exactly what was reviewed.
 * Kept: contacts, the customers' SMS and emails (unlinked from the deleted record, still on the
 * contact), tickets (unlinked from a deleted project) and the audit log (plus one "purge" entry
 * per deleted record). Take a database backup first (on the server, crm-cleanup-lead-ids does).
 */

const ACTOR: SystemActor = { system: 'system' };

export type CleanupPlan = Awaited<ReturnType<typeof planCleanup>>;

/** What would be deleted, without changing anything. */
export async function planCleanup(db: Db | Tx) {
  const projectRows = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      title: projects.title,
      suburb: projects.suburb,
      status: projects.status,
      leadId: projects.leadId,
      deletedAt: projects.deletedAt,
    })
    .from(projects)
    .leftJoin(leads, eq(leads.id, projects.leadId))
    .where(or(isNull(projects.leadId), isNull(leads.leadRef)))
    .orderBy(projects.createdAt);
  const leadRows = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      suburb: leads.suburb,
      status: leads.status,
      leadDate: leads.leadDate,
      deletedAt: leads.deletedAt,
    })
    .from(leads)
    .where(isNull(leads.leadRef))
    .orderBy(leads.createdAt);

  const projectIds = projectRows.map((p) => p.id);
  const leadIds = leadRows.map((l) => l.id);
  const on = (table: Parameters<typeof linkedTo>[0]) => linkedTo(table, projectIds, leadIds);
  const count = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const [activityCount, fileCount, smsCount, emailCount, draftCount, ticketCount] =
    await Promise.all([
      count(db.select({ n }).from(activities).where(on(activities))),
      count(db.select({ n }).from(files).where(on(files))),
      count(db.select({ n }).from(smsMessages).where(on(smsMessages))),
      count(db.select({ n }).from(emailMessages).where(on(emailMessages))),
      count(db.select({ n }).from(emailDrafts).where(on(emailDrafts))),
      projectIds.length
        ? count(db.select({ n }).from(tickets).where(inArray(tickets.projectId, projectIds)))
        : Promise.resolve(0),
    ]);

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ projects: [...projectIds].sort(), leads: [...leadIds].sort() }))
    .digest('hex')
    .slice(0, 12);
  return {
    projects: projectRows,
    leads: leadRows,
    attached: {
      activities: activityCount,
      files: fileCount,
      sms: smsCount,
      emails: emailCount,
      drafts: draftCount,
      tickets: ticketCount,
    },
    fingerprint,
  };
}

/** The plan in words, for the person deciding. */
export function describePlan(plan: CleanupPlan): string {
  const name = (l: { firstName: string; lastName: string | null }) =>
    [l.firstName, l.lastName].filter(Boolean).join(' ');
  const lines = [
    `Projects to delete (their lead has no Lead ID): ${String(plan.projects.length)}`,
    ...plan.projects.map(
      (p) =>
        `  - ${p.projectNumber} · ${p.title ?? 'untitled'} · ${p.suburb} · ${p.status}${p.deletedAt ? ' · already deleted' : ''}`,
    ),
    `Leads to delete (no Lead ID): ${String(plan.leads.length)}`,
    ...plan.leads.map(
      (l) =>
        `  - ${name(l)} · ${l.suburb ?? 'no suburb'} · ${l.status} · lead date ${l.leadDate}${l.deletedAt ? ' · already deleted' : ''}`,
    ),
    'Also deleted with them:',
    `  ${String(plan.attached.activities)} timeline entries, ${String(plan.attached.files)} files, ${String(plan.attached.drafts)} email drafts`,
    'Kept, but no longer linked to the deleted record (still on the contact):',
    `  ${String(plan.attached.sms)} SMS, ${String(plan.attached.emails)} emails, ${String(plan.attached.tickets)} tickets`,
    `Fingerprint: ${plan.fingerprint}`,
  ];
  return lines.join('\n');
}

/**
 * Deletes exactly the planned records, in one transaction; refuses when the records found now
 * don't match `expect` (someone added or fixed a Lead ID since the list was made). File bytes
 * are removed from storage after the commit.
 */
export async function runCleanup(
  db: Db,
  options: { expect: string; storage: Storage | null },
): Promise<{ plan: CleanupPlan; storageKeysLeft: string[] }> {
  const { plan, storageKeys } = await db.transaction(async (tx) => {
    // Nobody converts or edits a Lead ID half-way through: lock both tables for the clean-up.
    await tx.execute(sql`lock table ${leads}, ${projects} in share row exclusive mode`);
    const plan = await planCleanup(tx);
    if (plan.fingerprint !== options.expect) {
      throw new Error(
        `The records without a Lead ID changed since the list was made (fingerprint is now ${plan.fingerprint}, expected ${options.expect}). Nothing was deleted — list them again.`,
      );
    }
    const storageKeys = await purgeRecords(tx, {
      projectIds: plan.projects.map((p) => p.id),
      leadIds: plan.leads.map((l) => l.id),
    });
    for (const p of plan.projects) {
      await recordAudit(tx, ACTOR, {
        action: 'purge_no_lead_id',
        entityType: 'project',
        entityId: p.id,
        before: { projectNumber: p.projectNumber, title: p.title, suburb: p.suburb },
      });
    }
    for (const l of plan.leads) {
      await recordAudit(tx, ACTOR, {
        action: 'purge_no_lead_id',
        entityType: 'lead',
        entityId: l.id,
        before: { firstName: l.firstName, lastName: l.lastName, suburb: l.suburb },
      });
    }
    return { plan, storageKeys };
  });
  return { plan, storageKeysLeft: await removeStoredFiles(options.storage, storageKeys) };
}

async function main() {
  const { values } = parseArgs({
    options: { commit: { type: 'boolean', default: false }, expect: { type: 'string' } },
  });
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    if (!values.commit) {
      const plan = await planCleanup(db);
      console.log(describePlan(plan));
      console.log(
        plan.projects.length + plan.leads.length === 0
          ? '\nNothing to delete.'
          : `\nNothing was changed. To delete exactly this list: --commit --expect ${plan.fingerprint}`,
      );
      return;
    }
    if (!values.expect) {
      throw new Error('--commit needs --expect <fingerprint> from the list.');
    }
    const { plan, storageKeysLeft } = await runCleanup(db, {
      expect: values.expect,
      storage: createStorage(config),
    });
    console.log(describePlan(plan));
    console.log(
      `\nDeleted ${String(plan.projects.length)} projects and ${String(plan.leads.length)} leads.`,
    );
    if (storageKeysLeft.length) {
      console.log(
        `These stored files could not be removed from storage; delete them by hand:\n${storageKeysLeft.join('\n')}`,
      );
    }
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
