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
};

function record(data: unknown): Row {
  return (data || {}) as Row;
}

function listed(data: unknown): Row[] {
  if (Array.isArray(data)) {
    return data as Row[];
  }
  if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown[] }).rows)) {
    return (data as { rows: Row[] }).rows;
  }
  return [];
}

function itemsOf(data: unknown): Row[] {
  const value = record(data).items;
  return Array.isArray(value) ? (value as Row[]) : [];
}

describe('market sources', () => {
  let app: MockServer;
  let userA: User;
  let userB: User;

  beforeAll(async () => {
    app = await createMockServer({
      registerActions: true,
      acl: true,
      plugins: ['field-sort', 'users', 'auth', 'acl', 'data-source-manager', 'system-settings', 'market-catalog'],
    });
    const users = app.db.getRepository('users');
    userA = await users.create({ values: { nickname: 'src-a', roles: ['admin'] } });
    userB = await users.create({ values: { nickname: 'src-b', roles: ['admin'] } });
    await app.db.getRepository('marketPrincipals').create({
      values: { userId: userA.id, ncTenantId: 'tenant-a', ncSubjectId: 'subject-a' },
      context: { state: { currentUser: userA } },
    });
    await app.db.getRepository('marketPrincipals').create({
      values: { userId: userB.id, ncTenantId: 'tenant-b', ncSubjectId: 'subject-b' },
      context: { state: { currentUser: userB } },
    });
  });

  afterAll(async () => {
    if (app) {
      await app.destroy();
    }
  });

  async function session(user: User) {
    return app.agent().login(user, 'admin') as Promise<Session>;
  }

  async function source(user: User, sourceKey: string, adapterName: string) {
    const agent = await session(user);
    const created = await agent.resource('marketSources').create({
      values: { sourceKey, adapterName, displayName: sourceKey },
    });
    expect(created.status).toBe(200);
    return record(created.body.data);
  }

  it('records a source failure without returning items', async () => {
    const owner = await session(userA);
    await source(userA, 'broken', 'fixture-catalog');
    const queued = await owner.resource('marketSyncJobs').create({
      values: { sourceKey: 'broken', failMode: 'unavailable', kind: 'metadata-sync' },
    });
    expect(queued.status).toBe(200);
    expect(record(queued.body.data).state).toBe('queued');
    const ran = await owner.resource('marketSyncJobs').run({ filterByTk: record(queued.body.data).id });
    expect(ran.status).toBe(200);
    expect(record(ran.body.data).state).toBe('failed');
    expect(record(ran.body.data).errorCategory).toBe('source_unavailable');
    expect(record(ran.body.data).errorCode).toBe('source.unavailable');
    expect(itemsOf(ran.body.data)).toHaveLength(0);
  });

  it('pages metadata and keeps the next cursor', async () => {
    const owner = await session(userA);
    await source(userA, 'catalog', 'fixture-catalog');
    const firstQueued = await owner.resource('marketSyncJobs').create({
      values: { sourceKey: 'catalog', pageSize: 2, itemLimit: 2 },
    });
    const first = record(
      (await owner.resource('marketSyncJobs').run({ filterByTk: record(firstQueued.body.data).id })).body.data,
    );
    expect(first.state).toBe('succeeded');
    expect(itemsOf(first).map((item) => item.sourceItemId)).toEqual(['cat-1', 'cat-2']);
    expect(first.nextCursor).toBe('2');
    const secondQueued = await owner.resource('marketSyncJobs').create({
      values: { sourceKey: 'catalog', pageSize: 2, itemLimit: 2, cursor: first.nextCursor },
    });
    const second = record(
      (await owner.resource('marketSyncJobs').run({ filterByTk: record(secondQueued.body.data).id })).body.data,
    );
    expect(itemsOf(second).map((item) => item.sourceItemId)).toEqual(['cat-3', 'cat-4']);
    expect(second.nextCursor).toBe('4');
  });

  it('stores an unsupported capability where it can be listed', async () => {
    const owner = await session(userA);
    await source(userA, 'pages', 'fixture-pages');
    const queued = await owner.resource('marketSyncJobs').create({
      values: { sourceKey: 'pages', pageSize: 20 },
    });
    const ran = await owner.resource('marketSyncJobs').run({ filterByTk: record(queued.body.data).id });
    expect(record(ran.body.data).state).toBe('succeeded');
    const rows = listed(
      (
        await owner.resource('marketCapabilityDeclarations').list({
          filter: { sourceKey: 'pages' },
          paginate: false,
        })
      ).body.data,
    );
    const unsupported = rows.find((item) => item.capability === 'execution.multi_member');
    expect(unsupported?.status).toBe('unsupported');
    const supported = rows.find((item) => item.capability === 'resource.skill.install');
    expect(supported?.status).toBe('supported');
  });

  it('rejects an agent job and times out a stalled sync', async () => {
    const owner = await session(userA);
    await source(userA, 'slow', 'fixture-catalog');
    const agent = await owner.resource('marketSyncJobs').create({
      values: { sourceKey: 'slow', kind: 'agent' },
    });
    expect(agent.status).toBe(400);
    const queued = await owner.resource('marketSyncJobs').create({
      values: { sourceKey: 'slow', stallMs: 80, timeoutMs: 20, pageSize: 1 },
    });
    const ran = await owner.resource('marketSyncJobs').run({ filterByTk: record(queued.body.data).id });
    expect(record(ran.body.data).state).toBe('failed');
    expect(record(ran.body.data).errorCategory).toBe('timeout');
    expect(record(ran.body.data).errorCode).toBe('sync.timeout');
    expect(itemsOf(ran.body.data)).toHaveLength(0);
  });

  it('hides another tenant from sync jobs', async () => {
    const owner = await session(userA);
    await source(userA, 'private-source', 'fixture-catalog');
    const queued = await owner.resource('marketSyncJobs').create({
      values: { sourceKey: 'private-source', pageSize: 1 },
    });
    const job = record(queued.body.data);
    const other = await session(userB);
    const read = await other.resource('marketSyncJobs').get({ filterByTk: job.id });
    expect(read.body.data == null).toBe(true);
    const ran = await other.resource('marketSyncJobs').run({ filterByTk: job.id });
    expect(ran.status).toBe(404);
    const rows = listed((await other.resource('marketSyncJobs').list({ paginate: false })).body.data);
    expect(rows.map((item) => item.sourceKey)).not.toContain('private-source');
    const still = record((await owner.resource('marketSyncJobs').get({ filterByTk: job.id })).body.data);
    expect(still.state).toBe('queued');
  });
});
