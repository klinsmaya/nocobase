/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { createMockServer, MockServer } from '@nocobase/test';
import { PROFILE_SAMPLE, STANDARD_SAMPLE } from '../package-scan';

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

describe('market publishing', () => {
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
    userA = await users.create({ values: { nickname: 'pub-a', roles: ['admin'] } });
    userB = await users.create({ values: { nickname: 'pub-b', roles: ['admin'] } });
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

  async function resourceFor(user: User, name: string, visibility = 'private') {
    const agent = await session(user);
    const publisher = record(
      (
        await agent.resource('marketPublishers').create({
          values: { publisherSlug: `${name}-pub`, displayName: name },
        })
      ).body.data,
    );
    return record(
      (
        await agent.resource('marketResources').create({
          values: { publisherId: publisher.id, name, kind: 'skill', sourceKey: 'local', visibility },
        })
      ).body.data,
    );
  }

  function packageValues(resourceId: number, releaseId: string, extra: Row = {}) {
    return {
      resourceRowId: resourceId,
      releaseId,
      manifest: STANDARD_SAMPLE.manifest,
      files: STANDARD_SAMPLE.files,
      ...extra,
    };
  }

  it('rejects a digest that does not match the package', async () => {
    const owner = await session(userA);
    const resource = await resourceFor(userA, 'notes');
    const rejected = await owner.resource('marketReleases').create({
      values: packageValues(Number(resource.id), 'rel-mismatch', {
        declaredDigest: `sha256:${'ab'.repeat(32)}`,
      }),
    });
    expect(rejected.status).toBe(400);
    const rows = listed((await owner.resource('marketReleases').list({ paginate: false })).body.data);
    expect(rows.map((item) => item.releaseId)).not.toContain('rel-mismatch');
  });

  it('keeps scan, human review, and publisher verification as separate labels', async () => {
    const owner = await session(userA);
    const resource = await resourceFor(userA, 'labeled');
    const values = packageValues(Number(resource.id), 'rel-labels');
    values.manifest = { ...STANDARD_SAMPLE.manifest, name: 'labeled' };
    const created = await owner.resource('marketReleases').create({ values });
    expect(created.status).toBe(200);
    const release = record(created.body.data);
    expect(release.scanned).toBe(false);
    expect(release.humanReviewed).toBe(false);
    expect(release.publisherVerification).toBe('unverified');
    expect(release.license).toBe('Apache-2.0');

    const scanned = await owner.resource('marketReleases').scan({ filterByTk: release.id });
    expect(scanned.status).toBe(200);
    expect(record(scanned.body.data).passed).toBe(true);
    const afterScan = record((await owner.resource('marketReleases').get({ filterByTk: release.id })).body.data);
    expect(afterScan.scanned).toBe(true);
    expect(afterScan.scanPassed).toBe(true);
    expect(afterScan.humanReviewed).toBe(false);

    const unreviewed = await owner.resource('marketReleases').publish({ filterByTk: release.id });
    expect(unreviewed.status).toBe(409);

    const reviewed = await owner.resource('marketReleases').review({
      filterByTk: release.id,
      values: { decision: 'approved', publicMaterial: 'synthetic', reviewerUserId: userB.id },
    });
    expect(reviewed.status).toBe(200);
    expect(Number(record(reviewed.body.data).reviewerUserId)).toBe(userA.id);
    const afterReview = record((await owner.resource('marketReleases').get({ filterByTk: release.id })).body.data);
    expect(afterReview.humanReviewed).toBe(true);
    expect(afterReview.scanned).toBe(true);
    const publisher = record(
      (await owner.resource('marketPublishers').get({ filterByTk: resource.publisherId })).body.data,
    );
    expect(publisher.verificationStatus).toBe('unverified');
    expect(afterReview.publisherVerification).toBe('unverified');
  });

  it('locks published content and records publish', async () => {
    const owner = await session(userA);
    const resource = await resourceFor(userA, 'locked');
    const values = packageValues(Number(resource.id), 'rel-lock');
    values.manifest = { ...STANDARD_SAMPLE.manifest, name: 'locked' };
    const release = record((await owner.resource('marketReleases').create({ values })).body.data);
    const digest = String(release.digest);
    await owner.resource('marketReleases').scan({ filterByTk: release.id });
    await owner.resource('marketReleases').review({
      filterByTk: release.id,
      values: { decision: 'approved', publicMaterial: 'template' },
    });
    const published = await owner.resource('marketReleases').publish({ filterByTk: release.id });
    expect(published.status).toBe(200);
    expect(record(published.body.data).state).toBe('published');
    expect(record(published.body.data).digest).toBe(digest);
    const rewritten = await owner.resource('marketReleases').replace({
      filterByTk: release.id,
      values: { files: [{ path: 'skills/notes/SKILL.md', content: 'changed' }], digest: `sha256:${'cd'.repeat(32)}` },
    });
    expect(rewritten.status).toBe(409);
    const stored = record((await owner.resource('marketReleases').get({ filterByTk: release.id })).body.data);
    expect(stored.digest).toBe(digest);
    expect(stored.state).toBe('published');
    const events = listed((await owner.resource('marketAuditEvents').list({ paginate: false })).body.data).filter(
      (item) => item.releaseId === 'rel-lock' && item.action === 'publish',
    );
    expect(events).toHaveLength(1);
    expect(Number(events[0].actorUserId)).toBe(userA.id);
  });

  it('revokes with a reason and blocks distribution without deleting the release', async () => {
    const owner = await session(userA);
    const resource = await resourceFor(userA, 'revoked');
    const values = packageValues(Number(resource.id), 'rel-revoke');
    values.manifest = { ...STANDARD_SAMPLE.manifest, name: 'revoked' };
    const release = record((await owner.resource('marketReleases').create({ values })).body.data);
    await owner.resource('marketReleases').scan({ filterByTk: release.id });
    await owner.resource('marketReleases').review({
      filterByTk: release.id,
      values: { decision: 'approved', publicMaterial: 'explicitly_allowed' },
    });
    await owner.resource('marketReleases').publish({ filterByTk: release.id });
    const allowed = await owner.resource('marketReleases').distribute({ filterByTk: release.id });
    expect(allowed.status).toBe(200);
    expect(record(allowed.body.data).distribution).toBe('allowed');
    const revoked = await owner.resource('marketReleases').revoke({
      filterByTk: release.id,
      values: { reason: 'sample leaked', actorUserId: userB.id },
    });
    expect(revoked.status).toBe(200);
    expect(record(revoked.body.data).state).toBe('revoked');
    expect(record(revoked.body.data).revokeReason).toBe('sample leaked');
    expect(record(revoked.body.data).digest).toBe(release.digest);
    const blocked = await owner.resource('marketReleases').distribute({ filterByTk: release.id });
    expect(blocked.status).toBe(403);
    const still = record((await owner.resource('marketReleases').get({ filterByTk: release.id })).body.data);
    expect(still.releaseId).toBe('rel-revoke');
    const events = listed((await owner.resource('marketAuditEvents').list({ paginate: false })).body.data).filter(
      (item) => item.releaseId === 'rel-revoke' && item.action === 'revoke',
    );
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe('sample leaked');
    expect(Number(events[0].actorUserId)).toBe(userA.id);
  });

  it('requires an allowed public-material flag before public visibility', async () => {
    const owner = await session(userA);
    const resource = await resourceFor(userA, 'publiced', 'public');
    const values = packageValues(Number(resource.id), 'rel-public', { visibility: 'public' });
    values.manifest = { ...STANDARD_SAMPLE.manifest, name: 'publiced' };
    values.files = [{ path: 'skills/notes/SKILL.md', content: 'Contact ada@example.com about the template.\n' }];
    const release = record((await owner.resource('marketReleases').create({ values })).body.data);
    const scanned = await owner.resource('marketReleases').scan({ filterByTk: release.id });
    expect(record(scanned.body.data).passed).toBe(true);
    expect(record(scanned.body.data).piiSignals).toContain('email');
    await owner.resource('marketReleases').review({
      filterByTk: release.id,
      values: { decision: 'approved', publicMaterial: 'unspecified' },
    });
    const blocked = await owner.resource('marketReleases').publish({ filterByTk: release.id });
    expect(blocked.status).toBe(409);
    await owner.resource('marketReleases').review({
      filterByTk: release.id,
      values: { decision: 'approved', publicMaterial: 'synthetic' },
    });
    const published = await owner.resource('marketReleases').publish({ filterByTk: release.id });
    expect(published.status).toBe(200);
    expect(record(published.body.data).publicMaterial).toBe('synthetic');
  });

  it('hides another tenant from releases', async () => {
    const owner = await session(userA);
    const resource = await resourceFor(userA, 'secretpkg');
    const values = packageValues(Number(resource.id), 'rel-secret');
    values.manifest = { ...STANDARD_SAMPLE.manifest, name: 'secretpkg' };
    values.files = [{ path: 'skills/notes/SKILL.md', content: 'key AKIAIOSFODNN7EXAMPLE\n' }];
    const release = record((await owner.resource('marketReleases').create({ values })).body.data);
    const scanned = await owner.resource('marketReleases').scan({ filterByTk: release.id });
    expect(record(scanned.body.data).passed).toBe(false);
    expect(record(scanned.body.data).secretFindings).toContain('aws_access_key');
    const other = await session(userB);
    const read = await other.resource('marketReleases').get({ filterByTk: release.id });
    expect(read.body.data == null).toBe(true);
    const published = await other.resource('marketReleases').publish({ filterByTk: release.id });
    expect(published.status).toBe(404);
    const rows = listed((await other.resource('marketReleases').list({ paginate: false })).body.data);
    expect(rows.map((item) => item.releaseId)).not.toContain('rel-secret');
  });

  it('accepts the profile sample and rejects an unsafe path', async () => {
    const owner = await session(userA);
    const resource = await resourceFor(userA, 'research-agent');
    const created = await owner.resource('marketReleases').create({
      values: {
        resourceRowId: resource.id,
        releaseId: 'rel-profile',
        manifest: PROFILE_SAMPLE.manifest,
        files: PROFILE_SAMPLE.files,
      },
    });
    expect(created.status).toBe(200);
    expect(record(created.body.data).license).toBe('Apache-2.0');
    const unsafe = await owner.resource('marketReleases').create({
      values: {
        resourceRowId: resource.id,
        releaseId: 'rel-path',
        manifest: PROFILE_SAMPLE.manifest,
        files: [{ path: '../secrets.txt', content: 'nope' }],
      },
    });
    expect(unsafe.status).toBe(400);
  });
});
