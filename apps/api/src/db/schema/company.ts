import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { money, timestamps } from './_columns.ts';
import { users } from './users.ts';

/**
 * The business's own details (Step 2.10): one row, used on documents and emails later.
 * `id` is always true, so a second row can't exist.
 */
export const companyProfile = pgTable(
  'company_profile',
  {
    id: boolean().primaryKey().default(true),
    legalName: text().notNull(),
    tradingName: text(),
    abn: text(),
    phone: text(),
    email: text(),
    website: text(),
    streetAddress: text(),
    suburb: text(),
    state: text(),
    postcode: text(),
    /** Electrical contractor licence number(s). */
    electricalLicence: text(),
    /** Clean Energy Council retailer / installer accreditation. */
    cecAccreditation: text(),
    updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [check('company_profile_single_row', sql`${t.id}`)],
);

/**
 * STC rates and charges, set once for the whole business by an Admin (Settings → STC settings)
 * and used for every project's STC totals and the dashboard. Only Admins can read them.
 * `id` is always true, so a second row can't exist.
 */
export const stcSettings = pgTable(
  'stc_settings',
  {
    id: boolean().primaryKey().default(true),
    /** What the customer is credited per STC. */
    customerRateAud: money(),
    /** What the business receives per STC: STC amounts and totals are worked out with it. */
    internalRateAud: money(),
    /** Taken off each job's STC money received. */
    adminChargesAud: money(),
    updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [check('stc_settings_single_row', sql`${t.id}`)],
);
