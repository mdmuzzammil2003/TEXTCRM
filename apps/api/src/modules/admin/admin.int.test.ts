import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import type { SessionRevoker } from '../../auth/types.ts';
import { auditLog, hardwarePanels, roles, users } from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import type { JobQueue } from '../../jobs/queue.ts';
import type { Storage } from '../../storage/storage.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';
import { runImport } from '../imports/service.ts';
import { USER_LINKS } from './user-links.ts';

const createCaller = createCallerFactory(appRouter);

describe('admin settings (Step 2.10)', () => {
  const db = createTestDb();
  let adminId = '';
  let revoked: string[] = [];
  const sessions: SessionRevoker = {
    revoke: (uid) => {
      revoked.push(uid);
      return Promise.resolve();
    },
  };
  const objects = new Map<string, Buffer>();
  const storage: Storage = {
    presignUpload: (key) => Promise.resolve(`memory://${key}`),
    presignDownload: () => Promise.resolve(''),
    presignPreview: () => Promise.resolve(''),
    head: (key) =>
      Promise.resolve(
        objects.has(key) ? { sizeBytes: objects.get(key)?.length ?? 0, contentType: null } : null,
      ),
    read: (key) => Promise.resolve(objects.get(key) ?? Buffer.from('')),
    remove: () => Promise.resolve(),
  };
  const jobs: JobQueue = { send: () => Promise.resolve('job'), retry: () => Promise.resolve() };

  function as(permissions: PermissionMatrix = allPermissions(), id = adminId) {
    return createCaller(
      fakeContext(
        { status: 'authenticated', user: fakeUser({ id, permissions }), firebaseUid: 'uid' },
        { db, sessions, storage, jobs },
      ),
    );
  }
  const roleId = async (key: string) =>
    (await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]?.id ?? '';

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: adminId } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    revoked = [];
    objects.clear();
  });
  afterAll(() => db.$client.end());

  describe('users', () => {
    it('onboards a staff member: invite with a role; only the Workspace domain', async () => {
      const sales = await roleId('sales');
      const { id } = await as().admin.users.invite({
        email: ' Lavanya@MakeMySolar.com.au ',
        name: 'Lavanya',
        roleId: sales,
      });
      const list = await as().admin.users.list();
      expect(list.find((u) => u.id === id)).toMatchObject({
        email: 'lavanya@makemysolar.com.au',
        roleKey: 'sales',
        isActive: true,
        hasSignedIn: false,
      });
      await expect(
        as().admin.users.invite({ email: 'someone@gmail.com', name: 'X', roleId: sales }),
      ).rejects.toThrow('Only @makemysolar.com.au');
      await expect(
        as().admin.users.invite({ email: 'lavanya@makemysolar.com.au', name: 'L', roleId: sales }),
      ).rejects.toThrow('already has access');
    });

    it('offboards: deactivation revokes sessions, keeps the record, and can be undone', async () => {
      const { id } = await as().admin.users.invite({
        email: 'akash@makemysolar.com.au',
        name: 'Akash',
        roleId: await roleId('operations'),
      });
      await db.update(users).set({ firebaseUid: 'firebase-akash' }).where(eq(users.id, id));
      const result = await as().admin.users.setActive({ id, active: false });
      expect(result).toEqual({ id, sessionsRevoked: true, reassigned: { count: 0, to: null } });
      expect(revoked).toEqual(['firebase-akash']);
      const [row] = await db.select().from(users).where(eq(users.id, id));
      expect(row).toMatchObject({ isActive: false });
      expect(row?.deactivatedAt).not.toBeNull();
      await expect(
        as().admin.users.invite({
          email: 'akash@makemysolar.com.au',
          name: 'A',
          roleId: await roleId('sales'),
        }),
      ).rejects.toThrow('Reactivate them instead');
      await as().admin.users.setActive({ id, active: true });
      expect((await db.select().from(users).where(eq(users.id, id)))[0]).toMatchObject({
        isActive: true,
        deactivatedAt: null,
      });
    });

    it('never leaves the CRM without an active admin, and nobody locks themselves out', async () => {
      await expect(as().admin.users.setActive({ id: adminId, active: false })).rejects.toThrow(
        "can't deactivate yourself",
      );
      await expect(
        as().admin.users.update({
          id: adminId,
          values: { name: 'Micky', roleId: await roleId('sales') },
        }),
      ).rejects.toThrow("can't change your own role");
      const { id: other } = await as().admin.users.invite({
        email: 'neivedha@makemysolar.com.au',
        name: 'Neivedha',
        roleId: await roleId('service'),
      });
      // Another admin can't demote the only admin either.
      await expect(
        as(allPermissions(), other).admin.users.update({
          id: adminId,
          values: { name: 'Micky', roleId: await roleId('sales') },
        }),
      ).rejects.toThrow('only active admin');
      await as().admin.users.update({
        id: other,
        values: { name: 'Neivedha', roleId: await roleId('admin') },
      });
      await as(allPermissions(), other).admin.users.setActive({ id: adminId, active: false });
    });

    it('needs the users permission', async () => {
      const sales = emptyPermissionMatrix();
      sales.leads.view = true;
      await expect(as(sales).admin.users.list()).rejects.toThrow('does not allow');
    });
  });

  describe('permanently deleting a user', () => {
    const asRole = (key: string, id = adminId) =>
      createCaller(
        fakeContext(
          {
            status: 'authenticated',
            user: fakeUser({ id, role: { key, name: key }, permissions: allPermissions() }),
            firebaseUid: 'uid',
          },
          { db, sessions, storage, jobs },
        ),
      );
    const invite = async (email: string, role = 'sales') =>
      (
        await as().admin.users.invite({
          email,
          name: email.split('@')[0] ?? 'x',
          roleId: await roleId(role),
        })
      ).id;
    const linkedMessage =
      'This user has linked records (leads, audit logs, etc.) and cannot be deleted. Deactivate them instead.';

    it('deletes someone with no records (invited by mistake); the audit log keeps a record', async () => {
      const id = await invite('oops@makemysolar.com.au');
      expect(await asRole('admin').admin.users.deletePreview({ id })).toEqual({ links: [] });
      await asRole('admin').admin.users.permanentlyDelete({ id });
      expect(await db.select().from(users).where(eq(users.id, id))).toEqual([]);
      const [purge] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'purge')));
      expect(purge?.actorUserId).toBe(adminId);
    });

    it('refuses someone linked to records, and says what they are linked to', async () => {
      const id = await invite('seller@makemysolar.com.au');
      await as().leads.create({
        values: { firstName: 'Olivia', email: 'olivia@example.com', ownerUserId: id },
      });
      expect((await asRole('admin').admin.users.deletePreview({ id })).links).toContainEqual({
        label: 'leads owned',
        n: 1,
      });
      await expect(asRole('admin').admin.users.permanentlyDelete({ id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: linkedMessage,
      });
      // The admin has audit log entries of their own.
      const other = await invite('second-admin@makemysolar.com.au', 'admin');
      await expect(
        asRole('admin', other).admin.users.permanentlyDelete({ id: adminId }),
      ).rejects.toMatchObject({ message: linkedMessage });
      expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(1);
    });

    it('only an Admin, never yourself, never the last active admin', async () => {
      const id = await invite('nobody@makemysolar.com.au');
      for (const key of ['manager', 'sales', 'operations', 'service']) {
        await expect(asRole(key).admin.users.permanentlyDelete({ id })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await expect(asRole(key).admin.users.deletePreview({ id })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
      }
      await expect(asRole('admin', id).admin.users.permanentlyDelete({ id })).rejects.toThrow(
        "You can't delete yourself.",
      );
      // A fresh admin with no records is the only active admin once Micky is a manager.
      const soleAdmin = await invite('boss@makemysolar.com.au', 'admin');
      await db
        .update(users)
        .set({ roleId: await roleId('manager') })
        .where(eq(users.id, adminId));
      await expect(
        asRole('admin').admin.users.permanentlyDelete({ id: soleAdmin }),
      ).rejects.toThrow('only active admin');
      expect(await db.select().from(users).where(eq(users.id, soleAdmin))).toHaveLength(1);
    });

    it('checks every foreign key to users: each is either a linked record or a personal setting', async () => {
      // Deleted with the user on purpose (ON DELETE CASCADE): their own settings.
      const personal = [
        'email_drafts.user_id',
        'email_signatures.user_id',
        'integration_connections.user_id',
        'integration_oauth_states.user_id',
        'saved_views.user_id',
      ];
      const result = await db.execute<{ fk: string }>(sql`
        select c.conrelid::regclass::text || '.' || a.attname as fk
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype = 'f' and c.confrelid = 'users'::regclass`);
      const known = [...USER_LINKS.map((l) => `${l.table}.${l.column}`), ...personal].sort();
      expect(result.rows.map((row) => row.fk).sort()).toEqual(known);
    });
  });

  describe('roles & permissions', () => {
    it('edits a matrix (view follows other actions); Admin is locked', async () => {
      const list = await as().admin.roles.list();
      const service = list.find((r) => r.key === 'service');
      if (!service) throw new Error('seed missing');
      expect(service.permissions.tickets.edit).toBe(true);
      const next = structuredClone(service.permissions);
      next.reports = { view: false, create: false, edit: false, delete: false, export: true };
      next.tickets.delete = true;
      const saved = await as().admin.roles.setPermissions({ id: service.id, permissions: next });
      expect(saved.permissions.reports).toMatchObject({ view: true, export: true });
      expect(
        (await as().admin.roles.list()).find((r) => r.key === 'service')?.permissions.tickets
          .delete,
      ).toBe(true);

      const admin = list.find((r) => r.key === 'admin');
      expect(admin?.locked).toBe(true);
      await expect(
        as().admin.roles.setPermissions({ id: admin?.id ?? '', permissions: next }),
      ).rejects.toThrow('always has every permission');
    });

    it('creates a custom role from another, and deletes it only when unused', async () => {
      const { id } = await as().admin.roles.create({
        name: 'Service lead',
        copyFromRoleId: await roleId('service'),
      });
      const role = (await as().admin.roles.list()).find((r) => r.id === id);
      expect(role).toMatchObject({ key: 'service-lead', isSystem: false });
      expect(role?.permissions.tickets.edit).toBe(true);
      await expect(as().admin.roles.create({ name: 'service LEAD' })).rejects.toThrow(
        'already a role',
      );
      const { id: person } = await as().admin.users.invite({
        email: 'x@makemysolar.com.au',
        name: 'X',
        roleId: id,
      });
      await expect(as().admin.roles.remove({ id })).rejects.toThrow('1 person has this role');
      await as().admin.users.update({
        id: person,
        values: { name: 'X', roleId: await roleId('service') },
      });
      await as().admin.roles.remove({ id });
    });

    it('edits and deletes the built-in roles except Admin; people move to another role first', async () => {
      const sales = await roleId('sales');
      const service = await roleId('service');
      const admin = await roleId('admin');
      await as().admin.roles.update({
        id: sales,
        values: { name: 'Sales team', description: 'Leads and quotes' },
      });
      expect((await as().admin.roles.list()).find((r) => r.id === sales)).toMatchObject({
        name: 'Sales team',
        description: 'Leads and quotes',
      });
      await expect(
        as().admin.roles.update({ id: sales, values: { name: 'service' } }),
      ).rejects.toThrow('already a role');
      await expect(
        as().admin.roles.update({ id: admin, values: { name: 'Boss' } }),
      ).rejects.toThrow('Admin role');
      await expect(as().admin.roles.remove({ id: admin })).rejects.toThrow('Admin role');

      const { id: person } = await as().admin.users.invite({
        email: 'seller@makemysolar.com.au',
        name: 'Seller',
        roleId: sales,
      });
      expect((await as().admin.roles.list()).find((r) => r.id === sales)?.assignedUsers).toBe(1);
      await expect(as().admin.roles.remove({ id: sales })).rejects.toThrow(
        '1 person has this role',
      );
      await as().admin.roles.remove({ id: sales, reassignToRoleId: service });
      expect((await as().admin.roles.list()).some((r) => r.id === sales)).toBe(false);
      expect((await as().admin.users.list()).find((u) => u.id === person)?.roleKey).toBe('service');
    });
  });

  describe('option lists', () => {
    it('adds, rewords, reorders and archives options; protected values stay', async () => {
      const { id } = await as().admin.optionLists.add({ key: 'leadSources', label: 'TikTok' });
      await expect(
        as().admin.optionLists.add({ key: 'leadSources', label: 'tiktok' }),
      ).rejects.toThrow('already in the list');
      await as().admin.optionLists.rename({ id, label: 'TikTok Ads' });
      let list = await as().admin.optionLists.items({ key: 'leadSources' });
      const added = list.options.find((o) => o.id === id);
      expect(added).toMatchObject({ value: 'TikTok', label: 'TikTok Ads' }); // value kept for old records
      expect(list.options.at(-1)?.id).toBe(id);
      await as().admin.optionLists.move({ id, direction: 'up' });
      list = await as().admin.optionLists.items({ key: 'leadSources' });
      expect(list.options.at(-2)?.id).toBe(id);
      await as().admin.optionLists.setArchived({ id, archived: true });
      expect(
        (await as().optionLists.options({ keys: ['leadSources'] })).leadSources?.some(
          (o) => o.value === 'TikTok',
        ),
      ).toBe(false);

      const statuses = await as().admin.optionLists.items({ key: 'leadStatuses' });
      const lost = statuses.options.find((o) => o.value === 'Lost');
      expect(lost?.protection).toBe('protected');
      await expect(
        as().admin.optionLists.setArchived({ id: lost?.id ?? '', archived: true }),
      ).rejects.toThrow("can't be archived");
      expect((await as().admin.optionLists.items({ key: 'projectStages' })).fixed).toBe(true);
      await expect(
        as().admin.optionLists.add({ key: 'projectStages', label: 'Extra' }),
      ).rejects.toThrow('built into the app');
    });
  });

  describe('hardware catalogue', () => {
    it('adds and edits items, refusing duplicates; archives instead of deleting', async () => {
      const { id } = await as().admin.hardware.save({
        kind: 'panel',
        values: { manufacturer: 'Acme Solar', model: 'AS-440', sizeW: '440' },
      });
      await expect(
        as().admin.hardware.save({
          kind: 'panel',
          values: { manufacturer: 'ACME SOLAR', model: 'as-440', sizeW: '445' },
        }),
      ).rejects.toThrow('already in the catalogue');
      await as().admin.hardware.save({
        kind: 'panel',
        id,
        values: { manufacturer: 'Acme Solar', model: 'AS-440', series: 'Max', sizeW: '445' },
      });
      const found = await as().admin.hardware.list({ kind: 'panel', search: 'acme' });
      expect(found.rows).toEqual([
        expect.objectContaining({ id, size: '445.00', unit: 'W', series: 'Max' }) as unknown,
      ]);
      await as().admin.hardware.setArchived({ kind: 'panel', id, archived: true });
      expect((await as().admin.hardware.list({ kind: 'panel', search: 'acme' })).total).toBe(0);
      expect(
        (await as().admin.hardware.list({ kind: 'panel', search: 'acme', archived: true })).total,
      ).toBe(1);
    });

    it('imports panels from a spreadsheet with preview and de-duplication', async () => {
      await as().admin.hardware.save({
        kind: 'panel',
        values: { manufacturer: 'Acme Solar', model: 'AS-440', sizeW: '440' },
      });
      const csv = Buffer.from(
        'Brand,Model,Watts\nAcme Solar,AS-440,440\nacme solar,as-440,450\nNova,NV-500,500W\nNova,NV-500,500\nBroken,,300\n',
      );
      const ticket = await as().imports.createUpload({
        target: 'panels',
        fileName: 'panels.csv',
        sizeBytes: csv.length,
      });
      objects.set(ticket.uploadUrl.replace('memory://', ''), csv);
      await as().imports.completeUpload({ id: ticket.id });
      const source = await as().imports.source({ id: ticket.id });
      expect(source.mapping).toEqual({ manufacturer: 'Brand', model: 'Model', sizeW: 'Watts' });
      const preview = await as().imports.preview({ id: ticket.id, mapping: source.mapping });
      expect(preview.counts).toEqual({ create: 1, update: 0, skip: 3, error: 1 });
      await as().imports.start({ id: ticket.id });
      await runImport(db, ticket.id);
      const rows = await db
        .select()
        .from(hardwarePanels)
        .where(eq(hardwarePanels.manufacturer, 'Nova'));
      expect(rows).toEqual([
        expect.objectContaining({ model: 'NV-500', sizeW: '500.00', source: 'import' }) as unknown,
      ]);
    });
  });

  it('saves the company profile (ABN checked)', async () => {
    expect(await as().admin.company.get()).toBeNull();
    await expect(
      as().admin.company.save({ legalName: 'Make My Solar Pty Ltd', abn: '12 345 678 901' }),
    ).rejects.toThrow();
    await as().admin.company.save({
      legalName: 'Make My Solar Pty Ltd',
      tradingName: 'Make My Solar',
      abn: '51 824 753 556',
      state: 'NSW',
      postcode: '2150',
      email: 'Hello@MakeMySolar.com.au',
    });
    expect(await as().admin.company.get()).toMatchObject({
      legalName: 'Make My Solar Pty Ltd',
      abn: '51824753556',
      email: 'hello@makemysolar.com.au',
    });
  });
});
