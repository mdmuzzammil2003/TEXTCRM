import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.ts';

/**
 * Every column that points at a user and would be cleared (ON DELETE SET NULL) or lose rows
 * (email attachments, ON DELETE CASCADE) if the user were deleted — i.e. the user's footprint
 * in the CRM. A user with any of these is never deleted: the database would quietly forget who
 * did or owns what (the audit trail among it). An integration test checks this list against the
 * database, so a new foreign key to users can't be missed.
 *
 * Not listed, deleted with the user (ON DELETE CASCADE): their own settings — email drafts,
 * signatures, saved views, their Gmail connection and OAuth states.
 */
export const USER_LINKS: readonly { table: string; column: string; label: string }[] = [
  { table: 'audit_log', column: 'actor_user_id', label: 'audit log entries' },
  { table: 'activities', column: 'author_user_id', label: 'timeline entries' },
  { table: 'activities', column: 'assigned_user_id', label: 'assigned tasks' },
  { table: 'leads', column: 'owner_user_id', label: 'leads owned' },
  { table: 'leads', column: 'created_by_user_id', label: 'leads created' },
  { table: 'leads', column: 'updated_by_user_id', label: 'leads updated' },
  { table: 'contacts', column: 'owner_user_id', label: 'contacts owned' },
  { table: 'contacts', column: 'created_by_user_id', label: 'contacts created' },
  { table: 'contacts', column: 'updated_by_user_id', label: 'contacts updated' },
  { table: 'companies', column: 'owner_user_id', label: 'companies owned' },
  { table: 'companies', column: 'created_by_user_id', label: 'companies created' },
  { table: 'companies', column: 'updated_by_user_id', label: 'companies updated' },
  { table: 'projects', column: 'sales_user_id', label: 'projects as sales person' },
  { table: 'projects', column: 'created_by_user_id', label: 'projects created' },
  { table: 'projects', column: 'updated_by_user_id', label: 'projects updated' },
  { table: 'project_eb_verification', column: 'verified_by_user_id', label: 'bill verifications' },
  { table: 'project_installation', column: 'booked_by_user_id', label: 'installs booked' },
  { table: 'tickets', column: 'assigned_user_id', label: 'tickets assigned' },
  { table: 'tickets', column: 'created_by_user_id', label: 'tickets created' },
  { table: 'tickets', column: 'updated_by_user_id', label: 'tickets updated' },
  { table: 'sms_messages', column: 'sent_by_user_id', label: 'SMS sent' },
  { table: 'email_messages', column: 'sent_by_user_id', label: 'emails sent' },
  { table: 'email_messages', column: 'mailbox_user_id', label: 'emails in their mailbox' },
  { table: 'email_attachments', column: 'uploaded_by_user_id', label: 'email attachments' },
  { table: 'files', column: 'uploaded_by_user_id', label: 'files uploaded' },
  { table: 'import_jobs', column: 'created_by_user_id', label: 'imports' },
  { table: 'sheet_sync_sources', column: 'created_by_user_id', label: 'sheet syncs set up' },
  { table: 'sheet_sync_sources', column: 'updated_by_user_id', label: 'sheet syncs changed' },
  {
    table: 'integration_connections',
    column: 'connected_by_user_id',
    label: 'integrations connected',
  },
  { table: 'company_profile', column: 'updated_by_user_id', label: 'company profile changes' },
  { table: 'stc_settings', column: 'updated_by_user_id', label: 'STC settings changes' },
  { table: 'users', column: 'manager_user_id', label: 'people they manage' },
];

/** The user's linked records, by kind (only kinds with at least one). */
export async function userLinks(db: Db | Tx, userId: string) {
  const counts = USER_LINKS.map(
    // Identifiers come from the fixed list above, never from input.
    (link) =>
      sql`select ${link.label}::text as label, count(*)::int as n from ${sql.identifier(link.table)} where ${sql.identifier(link.column)} = ${userId}`,
  );
  const result = await db.execute<{ label: string; n: number }>(
    sql`select label, sum(n)::int as n from (${sql.join(counts, sql` union all `)}) linked group by label having sum(n) > 0 order by label`,
  );
  return result.rows;
}
