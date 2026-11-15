import { TRPCError } from '@trpc/server';
import { and, eq, ne } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.ts';
import { leads } from '../../db/schema/index.ts';

// The Lead ID (`leads.lead_id`, `leadRef` in code): typed in or read from a sheet, never made up.
// Unique across the CRM; it becomes the Project ID on conversion and is locked from then on.

export const LEAD_ID_TAKEN = 'This Lead ID already exists.';

/** The lead that already has this Lead ID (deleted ones included), other than `excludeId`. */
export async function leadWithRef(db: Db | Tx, leadRef: string, excludeId?: string) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.leadRef, leadRef), excludeId ? ne(leads.id, excludeId) : undefined))
    .limit(1);
  return lead ?? null;
}

/** Refuses a Lead ID another lead already has. */
export async function assertLeadRefFree(db: Db | Tx, leadRef: string | null, excludeId?: string) {
  if (leadRef && (await leadWithRef(db, leadRef, excludeId))) {
    throw new TRPCError({ code: 'CONFLICT', message: LEAD_ID_TAKEN });
  }
}

/** Whether a database error is the Lead ID unique index (two saves at the same moment). */
export function isLeadRefClash(error: unknown): boolean {
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error ? error.cause : error;
  if (typeof cause !== 'object' || cause === null) return false;
  // node-postgres puts the index name in `constraint`.
  const { code, constraint } = cause as { code?: unknown; constraint?: unknown };
  return code === '23505' && constraint === 'leads_lead_id_unique';
}

/** Runs a save; a Lead ID clash at the database becomes the same message as the pre-check. */
export async function withLeadRefCheck<T>(save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    if (isLeadRefClash(error)) throw new TRPCError({ code: 'CONFLICT', message: LEAD_ID_TAKEN });
    throw error;
  }
}
