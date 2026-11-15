import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { activities, auditLog, contacts, files, leads, projects } from './schema/index.ts';
import { loadLegacySeedInput, seed } from './seed.ts';
import { createTestDb, truncateAll } from '../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../test/fakes.ts';
import { appRouter } from '../trpc/router.ts';
import { createCallerFactory } from '../trpc/trpc.ts';
import { upsertUser } from '../users/upsert-user.ts';
import type { Storage } from '../storage/storage.ts';
import { describePlan, planCleanup, runCleanup } from './cleanup-missing-lead-ids.ts';

const createCaller = createCallerFactory(appRouter);

describe('clean-up of leads and projects without a Lead ID', () => {
  const db = createTestDb();
  let userId = '';
  const removed: string[] = [];
  const storage = {
    remove: (keys: string[]) => {
      removed.push(...keys);
      return Promise.resolve();
    },
  } as unknown as Storage;

  const as = () =>
    createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id: userId, permissions: allPermissions() }),
          firebaseUid: 'uid',
        },
        { db },
      ),
    );

  const site = {
    streetAddress: '12 Church St',
    suburb: 'Parramatta',
    state: 'NSW' as const,
    postcode: '2150',
  };

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: userId } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    removed.length = 0;
  });
  afterAll(() => db.$client.end());

  /** Valid: lead 7628533 and its project. Invalid: a lead with no ID, and an old project whose lead has none. */
  async function scenario() {
    const api = as();
    const { id: goodLead } = await api.leads.create({
      values: { leadRef: '7628533', firstName: 'Olivia', email: 'olivia@example.com', ...site },
    });
    const { id: goodProject } = await api.projects.convertLead({ leadId: goodLead });

    const { id: oldLead } = await api.leads.create({
      values: {
        leadRef: '1',
        firstName: 'Jack',
        email: 'jack@example.com',
        ...site,
        suburb: 'Ryde',
      },
    });
    const { id: oldProject } = await api.projects.convertLead({ leadId: oldLead });
    // Made before the rule: its lead has no Lead ID.
    await db.update(leads).set({ leadRef: null }).where(eq(leads.id, oldLead));
    await api.activities.create({
      entityType: 'project',
      entityId: oldProject,
      type: 'note',
      body: 'Old job',
    });
    await db.insert(files).values({
      entityType: 'project',
      entityId: oldProject,
      category: 'photo',
      fileName: 'roof.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 10,
      storageKey: 'projects/old/roof.jpg',
      thumbnailKey: 'projects/old/roof-thumb.jpg',
      status: 'ready',
    });

    const { id: noIdLead } = await api.leads.create({
      values: { firstName: 'Mia', email: 'mia@example.com', ...site, suburb: 'Epping' },
    });
    await api.activities.create({
      entityType: 'lead',
      entityId: noIdLead,
      type: 'note',
      body: 'Hi',
    });
    return { goodLead, goodProject, oldLead, oldProject, noIdLead };
  }

  it('lists what would go and changes nothing', async () => {
    const { oldLead, oldProject, noIdLead } = await scenario();
    const plan = await planCleanup(db);
    expect(plan.projects.map((p) => p.id)).toEqual([oldProject]);
    expect(plan.leads.map((l) => l.id).sort()).toEqual([oldLead, noIdLead].sort());
    expect(plan.attached).toMatchObject({ files: 1 });
    expect(describePlan(plan)).toContain(`Fingerprint: ${plan.fingerprint}`);
    expect(await db.select().from(projects)).toHaveLength(2);
    expect(await db.select().from(leads)).toHaveLength(3);
  });

  it('refuses a fingerprint that no longer matches, deleting nothing', async () => {
    await scenario();
    const { fingerprint } = await planCleanup(db);
    // Someone adds a lead without an ID after the list was made.
    await as().leads.create({ values: { firstName: 'Zoe', email: 'zoe@example.com' } });
    await expect(runCleanup(db, { expect: fingerprint, storage })).rejects.toThrow(
      /changed since the list was made/,
    );
    expect(await db.select().from(leads)).toHaveLength(4);
    expect(removed).toEqual([]);
  });

  it('deletes exactly the listed leads and projects with their timeline and files, keeping the rest', async () => {
    const { goodLead, goodProject, oldLead, oldProject, noIdLead } = await scenario();
    const { fingerprint } = await planCleanup(db);
    const { plan, storageKeysLeft } = await runCleanup(db, { expect: fingerprint, storage });
    expect(plan.projects).toHaveLength(1);
    expect(storageKeysLeft).toEqual([]);
    expect(removed.sort()).toEqual(['projects/old/roof-thumb.jpg', 'projects/old/roof.jpg']);

    expect((await db.select().from(projects)).map((p) => p.id)).toEqual([goodProject]);
    expect((await db.select().from(leads)).map((l) => l.id)).toEqual([goodLead]);
    const gone = [oldLead, oldProject, noIdLead];
    expect(await db.select().from(activities).where(inArray(activities.entityId, gone))).toEqual(
      [],
    );
    expect(await db.select().from(files)).toEqual([]);
    // Contacts stay; each deletion is in the audit log.
    expect((await db.select().from(contacts)).length).toBeGreaterThanOrEqual(2);
    const purges = await db.select().from(auditLog).where(eq(auditLog.action, 'purge_no_lead_id'));
    expect(purges.map((row) => row.entityId).sort()).toEqual(gone.sort());

    // Nothing left to do afterwards.
    expect(await planCleanup(db)).toMatchObject({ projects: [], leads: [] });
  });
});
