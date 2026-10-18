/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { createMockServer, MockServer } from '@nocobase/test';

type Row = Record<string, unknown>;
type User = { id: number };
type Session = {
  resource: (name: string) => {
    [action: string]: (params?: Record<string, unknown>) => Promise<{ status: number; body: { data?: unknown } }>;
  };
  set: (name: string, value: string) => Session;
};

const expiry = '2030-01-01T00:00:00Z';

function listed(data: unknown): Row[] {
  if (Array.isArray(data)) {
    return data as Row[];
  }
  if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown[] }).rows)) {
    return (data as { rows: Row[] }).rows;
  }
  return [];
}

function record(data: unknown): Row {
  return (data || {}) as Row;
}

describe('market catalog', () => {
  let app: MockServer;
  let userA: User;
  let userB: User;
  let userC: User;
  let unbound: User;

  beforeAll(async () => {
    app = await createMockServer({
      registerActions: true,
      acl: true,
      plugins: ['field-sort', 'users', 'auth', 'acl', 'data-source-manager', 'system-settings', 'market-catalog'],
    });
    const users = app.db.getRepository('users');
    userA = await users.create({ values: { nickname: 'tenant-a', roles: ['admin'] } });
    userB = await users.create({ values: { nickname: 'tenant-b', roles: ['admin'] } });
    userC = await users.create({ values: { nickname: 'tenant-a-other', roles: ['admin'] } });
    unbound = await users.create({ values: { nickname: 'unbound', roles: ['admin'] } });
    await bind(userA, 'tenant-a', 'subject-a');
    await bind(userB, 'tenant-b', 'subject-b');
    await bind(userC, 'tenant-a', 'subject-c');
  });

  afterAll(async () => {
    if (app) {
      await app.destroy();
    }
  });

  async function bind(user: User, ncTenantId: string, ncSubjectId: string) {
    await app.db.getRepository('marketPrincipals').create({
      values: { userId: user.id, ncTenantId, ncSubjectId },
      context: { state: { currentUser: user } },
    });
  }

  async function session(user: User) {
    return app.agent().login(user, 'admin') as Promise<Session>;
  }

  async function createPublisher(user: User, publisherSlug: string, displayName: string, extra: Row = {}) {
    const agent = await session(user);
    const response = await agent.resource('marketPublishers').create({
      values: { ...extra, publisherSlug, displayName },
    });
    return response;
  }

  it('rejects a stale draft ETag and leaves the saved draft in place', async () => {
    const owner = await session(userA);
    const publisher = record((await createPublisher(userA, 'cas-pub', 'CAS')).body.data);
    const resource = record(
      (
        await owner.resource('marketResources').create({
          values: { publisherId: publisher.id, name: 'notes', kind: 'skill', sourceKey: 'local' },
        })
      ).body.data,
    );
    const created = await owner.resource('marketDrafts').create({
      values: { resourceRowId: resource.id, title: 'first', revision: 9, etag: '9' },
    });
    expect(created.status).toBe(200);
    const draft = record(created.body.data);
    expect(draft.revision).toBe(1);
    expect(draft.etag).toBe('1');

    const current = await session(userA);
    current.set('If-Match', '1');
    const saved = await current.resource('marketDrafts').update({
      filterByTk: draft.id,
      values: { title: 'second' },
    });
    expect(saved.status).toBe(200);
    expect(record(saved.body.data).revision).toBe(2);
    expect(record(saved.body.data).title).toBe('second');

    const stale = await session(userA);
    stale.set('If-Match', '1');
    const rejected = await stale.resource('marketDrafts').update({
      filterByTk: draft.id,
      values: { title: 'third' },
    });
    expect(rejected.status).toBe(409);

    const missing = await (await session(userA)).resource('marketDrafts').update({
      filterByTk: draft.id,
      values: { title: 'fourth' },
    });
    expect(missing.status).toBe(428);

    const stored = record((await owner.resource('marketDrafts').get({ filterByTk: draft.id })).body.data);
    expect(stored.title).toBe('second');
    expect(stored.revision).toBe(2);
    expect(stored.etag).toBe('2');
  });

  it('hides and blocks another tenant reading or writing resources and mappings', async () => {
    const owner = await session(userA);
    const publisher = record((await createPublisher(userA, 'iso-pub', 'Isolated')).body.data);
    const resource = record(
      (
        await owner.resource('marketResources').create({
          values: {
            publisherId: publisher.id,
            name: 'secret-notes',
            kind: 'knowledge',
            summary: 'tenant-a-only',
          },
        })
      ).body.data,
    );
    const mapping = record(
      (
        await owner.resource('marketIdentityMappings').create({
          values: mappingValues('map-iso', 'subject-a'),
        })
      ).body.data,
    );
    const other = await session(userB);
    const listedResources = listed((await other.resource('marketResources').list()).body.data);
    expect(listedResources.map((item) => item.resourceId)).not.toContain('iso-pub/secret-notes');
    const read = await other.resource('marketResources').get({ filterByTk: resource.id });
    expect(read.body.data == null).toBe(true);
    expect(JSON.stringify(read.body)).not.toContain('tenant-a-only');
    const written = await other.resource('marketResources').update({
      filterByTk: resource.id,
      values: { summary: 'stolen' },
    });
    expect([200, 404]).toContain(written.status);
    expect(JSON.stringify(written.body)).not.toContain('stolen');
    const mappings = listed((await other.resource('marketIdentityMappings').list()).body.data);
    expect(mappings.map((item) => item.mappingId)).not.toContain('map-iso');
    const revised = await other.resource('marketIdentityMappings').revise({
      filterByTk: mapping.id,
      values: { expectedRevision: 1, expiry: '2031-01-01T00:00:00Z' },
    });
    expect(revised.status).toBe(404);
    const still = record((await owner.resource('marketResources').get({ filterByTk: resource.id })).body.data);
    expect(still.summary).toBe('tenant-a-only');
    expect(still.ncTenantId).toBe('tenant-a');
  });

  it('keeps same resource names from different publishers and sources as separate rows', async () => {
    const owner = await session(userA);
    const alpha = record((await createPublisher(userA, 'alpha', 'Alpha')).body.data);
    const beta = record((await createPublisher(userA, 'beta', 'Beta')).body.data);
    const first = await owner.resource('marketResources').create({
      values: { publisherId: alpha.id, name: 'research-agent', kind: 'agent', sourceKey: 'local' },
    });
    const second = await owner.resource('marketResources').create({
      values: { publisherId: beta.id, name: 'research-agent', kind: 'agent', sourceKey: 'local' },
    });
    const imported = await owner.resource('marketResources').create({
      values: { publisherId: alpha.id, name: 'research-agent', kind: 'agent', sourceKey: 'import' },
    });
    const duplicate = await owner.resource('marketResources').create({
      values: { publisherId: alpha.id, name: 'research-agent', kind: 'agent', sourceKey: 'local' },
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(imported.status).toBe(200);
    expect(duplicate.status).toBe(409);
    expect(record(first.body.data).resourceId).toBe('alpha/research-agent');
    expect(record(second.body.data).resourceId).toBe('beta/research-agent');
    expect(record(imported.body.data).resourceId).toBe('alpha/research-agent');
    expect(record(first.body.data).id).not.toBe(record(second.body.data).id);
    expect(record(first.body.data).id).not.toBe(record(imported.body.data).id);
    const renamed = await owner.resource('marketResources').update({
      filterByTk: record(first.body.data).id,
      values: { name: 'other-agent', sourceKey: 'merged', visibility: 'organization' },
    });
    expect(renamed.status).toBe(200);
    const stored = record(
      (await owner.resource('marketResources').get({ filterByTk: record(first.body.data).id })).body.data,
    );
    expect(stored.name).toBe('research-agent');
    expect(stored.sourceKey).toBe('local');
    expect(stored.resourceId).toBe('alpha/research-agent');
    expect(stored.visibility).toBe('organization');
    const rows = listed((await owner.resource('marketResources').list({ paginate: false })).body.data).filter(
      (item) => item.name === 'research-agent',
    );
    expect(rows).toHaveLength(3);
  });

  it('flags the previous mapping revision when the revision advances', async () => {
    const owner = await session(userA);
    const created = await owner.resource('marketIdentityMappings').create({
      values: { ...mappingValues('map-rev', 'subject-a'), revision: 4, invalidated: true, actor: 'client' },
    });
    expect(created.status).toBe(200);
    const current = record(created.body.data);
    expect(current.revision).toBe(1);
    expect(current.invalidated).toBe(false);
    const revised = await owner.resource('marketIdentityMappings').revise({
      filterByTk: current.id,
      values: { expectedRevision: 1, expiry: '2031-06-01T00:00:00Z' },
    });
    expect(revised.status).toBe(200);
    expect(record(revised.body.data).revision).toBe(2);
    expect(record(revised.body.data).invalidated).toBe(false);
    const stale = await owner.resource('marketIdentityMappings').revise({
      filterByTk: current.id,
      values: { expectedRevision: 1, expiry: '2032-01-01T00:00:00Z' },
    });
    expect(stale.status).toBe(409);
    const rows = listed(
      (
        await owner.resource('marketIdentityMappings').list({
          filter: { mappingId: 'map-rev' },
          paginate: false,
        })
      ).body.data,
    );
    expect(rows).toHaveLength(2);
    const previous = rows.find((item) => item.revision === 1);
    const next = rows.find((item) => item.revision === 2);
    expect(previous?.invalidated).toBe(true);
    expect(next?.invalidated).toBe(false);
    expect(next?.expiry).toBe('2031-06-01T00:00:00Z');
  });

  it('stores the authenticated user as actor and transfers ownership only through the action', async () => {
    const created = await createPublisher(userA, 'owned', 'Owned', {
      ownerUserId: userC.id,
      actor: 'mallory',
      actorUserId: userC.id,
    });
    expect(created.status).toBe(200);
    const publisher = record(created.body.data);
    expect(publisher.publisherSlug).toBe('owned');
    expect(Number(publisher.ownerUserId)).toBe(userA.id);
    const owner = await session(userA);
    const renamed = await owner.resource('marketPublishers').update({
      filterByTk: publisher.id,
      values: { displayName: 'Renamed', publisherSlug: 'renamed', ownerUserId: userC.id },
    });
    expect(renamed.status).toBe(200);
    const afterRename = record((await owner.resource('marketPublishers').get({ filterByTk: publisher.id })).body.data);
    expect(afterRename.displayName).toBe('Renamed');
    expect(afterRename.publisherSlug).toBe('owned');
    expect(Number(afterRename.ownerUserId)).toBe(userA.id);
    const intruder = await session(userC);
    const denied = await intruder.resource('marketPublishers').transferOwnership({
      filterByTk: publisher.id,
      values: { toUserId: userC.id, actorUserId: userA.id },
    });
    expect(denied.status).toBe(403);
    const moved = await owner.resource('marketPublishers').transferOwnership({
      filterByTk: publisher.id,
      values: { toUserId: userC.id, actor: 'mallory', actorUserId: userB.id },
    });
    expect(moved.status).toBe(200);
    expect(Number(record(moved.body.data).ownerUserId)).toBe(userC.id);
    const events = listed((await owner.resource('marketOwnershipEvents').list({ paginate: false })).body.data).filter(
      (item) => Number(item.publisherId) === Number(publisher.id),
    );
    expect(events).toHaveLength(1);
    expect(Number(events[0].fromUserId)).toBe(userA.id);
    expect(Number(events[0].toUserId)).toBe(userC.id);
    expect(Number(events[0].actorUserId)).toBe(userA.id);
    const outsider = await session(unbound);
    const blocked = await outsider.resource('marketPublishers').list();
    expect(blocked.status).toBe(403);
    const emailed = await owner.resource('marketIdentityMappings').create({
      values: { ...mappingValues('map-mail', 'subject-a'), email: 'a@example.com', linkMethod: 'email' },
    });
    expect(emailed.status).toBe(400);
  });
});

function mappingValues(mappingId: string, ncSubjectId: string): Row {
  return {
    mappingId,
    ncSubjectId,
    consumerType: 'dsh',
    consumerId: 'consumer_a',
    consumerTenantId: 'consumer-tenant',
    consumerSubjectId: 'consumer-subject',
    targetScopeKind: 'profile',
    targetScopeId: 'profile_a',
    allowedScope: ['catalog.read'],
    expiry,
    verification: 'verified',
  };
}
