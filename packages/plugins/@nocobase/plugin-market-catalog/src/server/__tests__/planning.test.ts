/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { createMockServer, MockServer } from '@nocobase/test';
import { digestOf, freezeHash, freshnessReasons, type FrozenPlanInput } from '../plan-document';
import { STANDARD_SAMPLE } from '../package-scan';

type Row = Record<string, unknown>;
type User = { id: number };
type Session = {
  resource: (name: string) => {
    [action: string]: (params?: Record<string, unknown>) => Promise<{ status: number; body: { data?: unknown } }>;
  };
};

const expiry = '2035-01-01T00:00:00Z';

function sha(byte: string) {
  return `sha256:${byte.repeat(32)}`;
}

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

function reasons(value: unknown) {
  return String(value ?? '')
    .split(',')
    .filter((item) => item.length > 0);
}

function preflight(
  id: string,
  steps: Array<{ action: string; id: string }> = [
    { action: 'fetch', id: 'fetch' },
    { action: 'bind', id: 'bind' },
  ],
) {
  return {
    adapterVersion: 'multica-1',
    expiresAt: '2035-06-01T00:00:00Z',
    preflightId: id,
    runtimeCapabilitiesDigest: sha('ab'),
    source: 'live',
    status: 'ready',
    steps,
  };
}

describe('plan hash', () => {
  const input = {
    adapterVersion: 'multica-1',
    consumerId: 'consumer_a',
    consumerSubjectId: 'consumer-subject',
    consumerTenantId: 'consumer-tenant',
    consumerType: 'multica',
    credentialRefs: [
      { purpose: 'sync', ref: 'vault_b' },
      { purpose: 'sync', ref: 'vault_a' },
    ],
    dependencyLock: [
      { digest: sha('11'), name: 'beta', version: '1.0.0' },
      { digest: sha('22'), name: 'alpha', version: '1.0.0' },
    ],
    destinations: ['workspace'],
    expiry,
    feeMode: 'none',
    mappingId: 'map-hash',
    mappingRevision: 1,
    permissions: ['install.run', 'catalog.read'],
    policyId: 'pol-hash',
    policyVersion: 1,
    preflight: preflight('pf-hash'),
    releaseDigest: sha('aa'),
    releaseId: 'rel-hash',
    releaseVersion: '0.1.0',
    runtimeCapabilitiesDigest: sha('ab'),
    targetScopeId: 'workspace_a',
    targetScopeKind: 'workspace',
  } satisfies FrozenPlanInput;

  it('hashes the same normalized plan when key and list order change', () => {
    expect(digestOf({ b: 1, a: { d: 1, c: 2 } })).toBe(digestOf({ a: { c: 2, d: 1 }, b: 1 }));
    const reversed: FrozenPlanInput = {
      ...input,
      credentialRefs: [...input.credentialRefs].reverse(),
      dependencyLock: [...input.dependencyLock].reverse(),
      permissions: [...input.permissions].reverse(),
    };
    expect(freezeHash(reversed)).toBe(freezeHash(input));
    expect(freezeHash(input)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      freezeHash({
        ...input,
        preflight: preflight('pf-hash', [
          { action: 'bind', id: 'bind' },
          { action: 'fetch', id: 'fetch' },
        ]),
      }),
    ).not.toBe(freezeHash(input));
  });

  it('names the fact that moved', () => {
    const plan = {
      consumerType: 'multica' as const,
      mappingRevision: 1,
      permissionDigest: sha('aa'),
      planHash: sha('bb'),
      policyVersion: 1,
      preflightDigest: sha('cc'),
      releaseDigest: sha('dd'),
    };
    const facts = {
      allowedConsumerTypes: ['multica' as const],
      approvalActive: true,
      approvalPlanHash: plan.planHash,
      mappingExpiry: expiry,
      mappingInvalidated: false,
      mappingRevision: 1,
      mappingVerification: 'verified' as const,
      now: Date.parse('2026-10-18T00:00:00Z'),
      permissionDigest: plan.permissionDigest,
      policyActive: true,
      policyVersion: 1,
      preflightDigest: plan.preflightDigest,
      preflightExpiry: expiry,
      releaseDigest: plan.releaseDigest,
      releaseState: 'published',
      requireVerifiedMapping: true,
    };
    expect(freshnessReasons(plan, facts)).toEqual([]);
    expect(freshnessReasons(plan, { ...facts, mappingRevision: 2 })).toContain('mapping_revision');
    expect(freshnessReasons(plan, { ...facts, policyVersion: 2 })).toContain('policy_version');
    expect(freshnessReasons(plan, { ...facts, permissionDigest: sha('ee') })).toContain('permissions');
    expect(freshnessReasons(plan, { ...facts, preflightDigest: sha('ff') })).toContain('preflight_digest');
    expect(freshnessReasons(plan, { ...facts, releaseDigest: sha('11') })).toContain('release_digest');
    expect(freshnessReasons(plan, { ...facts, releaseState: 'revoked' })).toContain('release_revoked');
    expect(freshnessReasons(plan, { ...facts, allowedConsumerTypes: ['dsh'] })).toContain('policy');
    expect(freshnessReasons(plan, { ...facts, approvalActive: false })).toContain('approval_missing');
  });
});

describe('market planning', () => {
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
    userA = await users.create({ values: { nickname: 'plan-a', roles: ['admin'] } });
    userB = await users.create({ values: { nickname: 'plan-b', roles: ['admin'] } });
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

  function mappingValues(mappingId: string): Row {
    return {
      allowedScope: ['catalog.read'],
      consumerId: 'consumer_a',
      consumerSubjectId: 'consumer-subject',
      consumerTenantId: 'consumer-tenant',
      consumerType: 'multica',
      expiry,
      mappingId,
      ncSubjectId: 'subject-a',
      targetScopeId: 'workspace_a',
      targetScopeKind: 'workspace',
      verification: 'verified',
    };
  }

  async function published(owner: Session, name: string, releaseId: string) {
    const publisher = record(
      (
        await owner.resource('marketPublishers').create({
          values: { displayName: name, publisherSlug: `${name}-pub` },
        })
      ).body.data,
    );
    const resource = record(
      (
        await owner.resource('marketResources').create({
          values: { kind: 'skill', name, publisherId: publisher.id, sourceKey: 'local', visibility: 'private' },
        })
      ).body.data,
    );
    const created = record(
      (
        await owner.resource('marketReleases').create({
          values: {
            files: STANDARD_SAMPLE.files,
            manifest: { ...STANDARD_SAMPLE.manifest, name },
            releaseId,
            resourceRowId: resource.id,
          },
        })
      ).body.data,
    );
    expect((await owner.resource('marketReleases').scan({ filterByTk: created.id })).status).toBe(200);
    expect(
      (
        await owner.resource('marketReleases').review({
          filterByTk: created.id,
          values: { decision: 'approved', publicMaterial: 'template' },
        })
      ).status,
    ).toBe(200);
    const result = await owner.resource('marketReleases').publish({ filterByTk: created.id });
    expect(result.status).toBe(200);
    return record(result.body.data);
  }

  async function policy(owner: Session, policyId: string, extra: Row = {}) {
    const created = await owner.resource('marketPolicies').create({
      values: {
        allowedConsumerTypes: ['dsh', 'multica'],
        destinations: ['workspace'],
        feeMode: 'none',
        permissions: ['catalog.read', 'install.run'],
        policyId,
        requireVerifiedMapping: true,
        ...extra,
      },
    });
    expect(created.status).toBe(200);
    return record(created.body.data);
  }

  async function mapping(owner: Session, mappingId: string) {
    const created = await owner.resource('marketIdentityMappings').create({ values: mappingValues(mappingId) });
    expect(created.status).toBe(200);
    return record(created.body.data);
  }

  async function freeze(
    owner: Session,
    release: Row,
    identity: Row,
    rules: Row,
    extra: {
      credentialRefs?: Row[];
      dependencies?: Row[];
      preflightId?: string;
      steps?: Array<{ action: string; id: string }>;
    } = {},
  ) {
    const resolved = await owner.resource('marketPlans').resolve({
      values: {
        credentialRefs: extra.credentialRefs,
        dependencies: extra.dependencies,
        mappingRowId: identity.id,
        planHash: sha('ff'),
        policyId: rules.policyId,
        releaseRowId: release.id,
      },
    });
    expect(resolved.status).toBe(200);
    const expected = record(resolved.body.data);
    expect(expected.state).toBe('expected');
    expect(expected.planHash == null).toBe(true);
    const finalized = await owner.resource('marketPlans').finalize({
      filterByTk: expected.id,
      values: { preflight: preflight(extra.preflightId ?? 'pf-ready', extra.steps) },
    });
    expect(finalized.status).toBe(200);
    return record(finalized.body.data);
  }

  async function approvalFor(owner: Session, planId: unknown) {
    const rows = listed(
      (
        await owner.resource('marketApprovals').list({
          filter: { planId },
          paginate: false,
        })
      ).body.data,
    );
    return rows[0];
  }

  it('keeps planHash stable for the same normalized plan', async () => {
    const owner = await session(userA);
    const release = await published(owner, 'hashpkg', 'rel-hashpkg');
    const identity = await mapping(owner, 'map-hashpkg');
    const rules = await policy(owner, 'pol-hashpkg');
    const dependencies = [
      { digest: sha('11'), name: 'beta', version: '1.0.0' },
      { digest: sha('22'), name: 'alpha', version: '1.0.0' },
    ];
    const credentialRefs = [
      { purpose: 'sync', ref: 'vault_b' },
      { purpose: 'sync', ref: 'vault_a' },
    ];
    const first = await freeze(owner, release, identity, rules, {
      credentialRefs,
      dependencies,
      preflightId: 'pf-hashpkg',
    });
    const second = await freeze(owner, release, identity, rules, {
      credentialRefs: [...credentialRefs].reverse(),
      dependencies: [...dependencies].reverse(),
      preflightId: 'pf-hashpkg',
    });
    expect(first.planHash).toBe(second.planHash);
    expect(String(first.planHash)).toMatch(/^sha256:[a-f0-9]{64}$/);
    const third = await freeze(owner, release, identity, rules, {
      credentialRefs,
      dependencies,
      preflightId: 'pf-hashpkg',
      steps: [
        { action: 'bind', id: 'bind' },
        { action: 'fetch', id: 'fetch' },
      ],
    });
    expect(third.planHash).not.toBe(first.planHash);
    const again = await owner.resource('marketPlans').finalize({
      filterByTk: first.id,
      values: { preflight: preflight('pf-other') },
    });
    expect(again.status).toBe(409);
    const stored = record((await owner.resource('marketPlans').get({ filterByTk: first.id })).body.data);
    expect(stored.planHash).toBe(first.planHash);
    expect(stored.state).toBe('frozen');
  });

  it('refuses to freeze a blocked or stub preflight', async () => {
    const owner = await session(userA);
    const release = await published(owner, 'blockedpkg', 'rel-blockedpkg');
    const identity = await mapping(owner, 'map-blockedpkg');
    const rules = await policy(owner, 'pol-blockedpkg');
    const resolved = record(
      (
        await owner.resource('marketPlans').resolve({
          values: { mappingRowId: identity.id, policyId: rules.policyId, releaseRowId: release.id },
        })
      ).body.data,
    );
    const blocked = await owner.resource('marketPlans').finalize({
      filterByTk: resolved.id,
      values: { preflight: { ...preflight('pf-blocked'), status: 'blocked' } },
    });
    expect(blocked.status).toBe(409);
    const stubbed = await owner.resource('marketPlans').finalize({
      filterByTk: resolved.id,
      values: { preflight: { ...preflight('pf-stub'), source: 'stub' } },
    });
    expect(stubbed.status).toBe(409);
    const stored = record((await owner.resource('marketPlans').get({ filterByTk: resolved.id })).body.data);
    expect(stored.state).toBe('expected');
    expect(stored.planHash == null).toBe(true);
    const reports = listed((await owner.resource('marketPreflights').list({ paginate: false })).body.data).filter(
      (item) => item.planId === resolved.planId,
    );
    expect(reports.map((item) => item.status).sort()).toEqual(['blocked', 'ready']);
    expect(reports.map((item) => item.source).sort()).toEqual(['live', 'stub']);
  });

  it('rejects credential secrets before creating a plan', async () => {
    const owner = await session(userA);
    const release = await published(owner, 'secretpkg', 'rel-secretpkg');
    const identity = await mapping(owner, 'map-secretpkg');
    const rules = await policy(owner, 'pol-secretpkg');
    const rejected = await owner.resource('marketPlans').resolve({
      values: {
        credentialRefs: [{ purpose: 'sync', ref: 'vault_sync', token: 'sekret' }],
        mappingRowId: identity.id,
        policyId: rules.policyId,
        releaseRowId: release.id,
      },
    });
    expect(rejected.status).toBe(400);
    const rows = listed((await owner.resource('marketPlans').list({ paginate: false })).body.data);
    expect(rows.map((item) => item.releaseId)).not.toContain('rel-secretpkg');
  });

  it('binds approval to the exact planHash and rejects a stale one after each fact moves', async () => {
    const owner = await session(userA);
    const release = await published(owner, 'factpkg', 'rel-factpkg');
    const identity = await mapping(owner, 'map-factpkg');
    const rules = await policy(owner, 'pol-factpkg');
    const plan = await freeze(owner, release, identity, rules, { preflightId: 'pf-factpkg' });
    const wrong = await owner.resource('marketPlans').approve({
      filterByTk: plan.id,
      values: { planHash: sha('ff') },
    });
    expect(wrong.status).toBe(409);
    const approved = await owner.resource('marketPlans').approve({
      filterByTk: plan.id,
      values: { planHash: plan.planHash, approverUserId: userB.id },
    });
    expect(approved.status).toBe(200);
    expect(Number(record(approved.body.data).approverUserId)).toBe(userA.id);
    expect(record(approved.body.data).planHash).toBe(plan.planHash);
    const repeat = await owner.resource('marketPlans').approve({
      filterByTk: plan.id,
      values: { planHash: plan.planHash },
    });
    expect(repeat.status).toBe(200);
    expect(record(repeat.body.data).approvalId).toBe(record(approved.body.data).approvalId);
    const open = await owner.resource('marketPlans').eligibility({ filterByTk: plan.id });
    expect(open.status).toBe(200);
    expect(record(open.body.data).distribution).toBe('allowed');

    const revisedMapping = await owner.resource('marketIdentityMappings').revise({
      filterByTk: identity.id,
      values: { expectedRevision: 1, expiry: '2036-01-01T00:00:00Z' },
    });
    expect(revisedMapping.status).toBe(200);
    const afterMapping = await approvalFor(owner, plan.planId);
    expect(afterMapping.state).toBe('invalidated');
    expect(reasons(afterMapping.invalidatedReason)).toContain('mapping_revision');
    expect((await owner.resource('marketPlans').eligibility({ filterByTk: plan.id })).status).toBe(403);
    expect(
      (await owner.resource('marketPlans').approve({ filterByTk: plan.id, values: { planHash: plan.planHash } }))
        .status,
    ).toBe(409);
  });

  it('invalidates approval when the policy version or permissions change', async () => {
    const owner = await session(userA);
    const release = await published(owner, 'polpkg', 'rel-polpkg');
    const identity = await mapping(owner, 'map-polpkg');
    const rules = await policy(owner, 'pol-polpkg');
    const versionPlan = await freeze(owner, release, identity, rules, { preflightId: 'pf-pol-version' });
    expect(
      (
        await owner
          .resource('marketPlans')
          .approve({ filterByTk: versionPlan.id, values: { planHash: versionPlan.planHash } })
      ).status,
    ).toBe(200);
    const samePermissions = await owner.resource('marketPolicies').revise({
      filterByTk: rules.id,
      values: {
        allowedConsumerTypes: ['dsh', 'multica'],
        destinations: ['workspace'],
        expectedRevision: 1,
        feeMode: 'none',
        permissions: ['install.run', 'catalog.read'],
        requireVerifiedMapping: true,
      },
    });
    expect(samePermissions.status).toBe(200);
    const afterVersion = await approvalFor(owner, versionPlan.planId);
    expect(reasons(afterVersion.invalidatedReason)).toContain('policy_version');
    expect(reasons(afterVersion.invalidatedReason)).not.toContain('permissions');

    const currentPolicy = record(samePermissions.body.data);
    const permissionPlan = await freeze(owner, release, identity, currentPolicy, { preflightId: 'pf-pol-perm' });
    expect(
      (
        await owner.resource('marketPlans').approve({
          filterByTk: permissionPlan.id,
          values: { planHash: permissionPlan.planHash },
        })
      ).status,
    ).toBe(200);
    const changedPermissions = await owner.resource('marketPolicies').revise({
      filterByTk: currentPolicy.id,
      values: {
        allowedConsumerTypes: ['dsh', 'multica'],
        destinations: ['workspace'],
        expectedRevision: currentPolicy.policyVersion,
        feeMode: 'none',
        permissions: ['budget.read', 'catalog.read'],
        requireVerifiedMapping: true,
      },
    });
    expect(changedPermissions.status).toBe(200);
    const afterPermissions = await approvalFor(owner, permissionPlan.planId);
    expect(reasons(afterPermissions.invalidatedReason)).toEqual(
      expect.arrayContaining(['permissions', 'policy_version']),
    );

    const narrowedPolicy = record(changedPermissions.body.data);
    const consumerPlan = await freeze(owner, release, identity, narrowedPolicy, { preflightId: 'pf-pol-consumer' });
    expect(
      (
        await owner.resource('marketPlans').approve({
          filterByTk: consumerPlan.id,
          values: { planHash: consumerPlan.planHash },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner.resource('marketPolicies').revise({
          filterByTk: narrowedPolicy.id,
          values: {
            allowedConsumerTypes: ['dsh'],
            destinations: ['workspace'],
            expectedRevision: narrowedPolicy.policyVersion,
            feeMode: 'none',
            permissions: ['budget.read', 'catalog.read'],
            requireVerifiedMapping: true,
          },
        })
      ).status,
    ).toBe(200);
    expect((await owner.resource('marketPlans').eligibility({ filterByTk: consumerPlan.id })).status).toBe(403);
    const afterPolicy = await approvalFor(owner, consumerPlan.planId);
    expect(reasons(afterPolicy.invalidatedReason)).toContain('policy');
  });

  it('keeps the frozen hash when a later preflight is recorded', async () => {
    const owner = await session(userA);
    const release = await published(owner, 'preflightpkg', 'rel-preflightpkg');
    const identity = await mapping(owner, 'map-preflightpkg');
    const rules = await policy(owner, 'pol-preflightpkg');
    const plan = await freeze(owner, release, identity, rules, { preflightId: 'pf-preflightpkg' });
    expect(
      (await owner.resource('marketPlans').approve({ filterByTk: plan.id, values: { planHash: plan.planHash } }))
        .status,
    ).toBe(200);
    const recorded = await owner.resource('marketPlans').recordPreflight({
      filterByTk: plan.id,
      values: { preflight: preflight('pf-preflightpkg-2', [{ action: 'fetch', id: 'fetch' }]) },
    });
    expect(recorded.status).toBe(200);
    const stored = record((await owner.resource('marketPlans').get({ filterByTk: plan.id })).body.data);
    expect(stored.planHash).toBe(plan.planHash);
    expect(stored.state).toBe('frozen');
    const afterPreflight = await approvalFor(owner, plan.planId);
    expect(afterPreflight.state).toBe('invalidated');
    expect(reasons(afterPreflight.invalidatedReason)).toEqual(['preflight_digest']);
    expect((await owner.resource('marketPlans').eligibility({ filterByTk: plan.id })).status).toBe(403);
  });

  it('stops distribution when the release is revoked or its digest changes', async () => {
    const owner = await session(userA);
    const release = await published(owner, 'revokepkg', 'rel-revokepkg');
    const identity = await mapping(owner, 'map-revokepkg');
    const rules = await policy(owner, 'pol-revokepkg');
    const plan = await freeze(owner, release, identity, rules, { preflightId: 'pf-revokepkg' });
    expect(
      (await owner.resource('marketPlans').approve({ filterByTk: plan.id, values: { planHash: plan.planHash } }))
        .status,
    ).toBe(200);
    const revoked = await owner.resource('marketReleases').revoke({
      filterByTk: release.id,
      values: { reason: 'sample leaked' },
    });
    expect(revoked.status).toBe(200);
    const afterRevoke = await approvalFor(owner, plan.planId);
    expect(afterRevoke.state).toBe('invalidated');
    expect(reasons(afterRevoke.invalidatedReason)).toContain('release_revoked');
    expect((await owner.resource('marketPlans').eligibility({ filterByTk: plan.id })).status).toBe(403);
    expect((await owner.resource('marketReleases').distribute({ filterByTk: release.id })).status).toBe(403);

    const other = await published(owner, 'digestpkg', 'rel-digestpkg');
    const otherIdentity = await mapping(owner, 'map-digestpkg');
    const otherRules = await policy(owner, 'pol-digestpkg');
    const otherPlan = await freeze(owner, other, otherIdentity, otherRules, { preflightId: 'pf-digestpkg' });
    expect(
      (
        await owner
          .resource('marketPlans')
          .approve({ filterByTk: otherPlan.id, values: { planHash: otherPlan.planHash } })
      ).status,
    ).toBe(200);
    await app.db.getCollection('marketReleases').model.update({ digest: sha('cd') }, { where: { id: other.id } });
    expect((await owner.resource('marketPlans').eligibility({ filterByTk: otherPlan.id })).status).toBe(403);
    const afterDigest = await approvalFor(owner, otherPlan.planId);
    expect(afterDigest.state).toBe('invalidated');
    expect(reasons(afterDigest.invalidatedReason)).toContain('release_digest');
  });

  it('hides plans from another tenant', async () => {
    const owner = await session(userA);
    const release = await published(owner, 'isolatedpkg', 'rel-isolatedpkg');
    const identity = await mapping(owner, 'map-isolatedpkg');
    const rules = await policy(owner, 'pol-isolatedpkg');
    const plan = await freeze(owner, release, identity, rules, { preflightId: 'pf-isolatedpkg' });
    const other = await session(userB);
    const read = await other.resource('marketPlans').get({ filterByTk: plan.id });
    expect(read.body.data == null).toBe(true);
    expect((await other.resource('marketPlans').eligibility({ filterByTk: plan.id })).status).toBe(404);
    const rows = listed((await other.resource('marketPlans').list({ paginate: false })).body.data);
    expect(rows.map((item) => item.planId)).not.toContain(plan.planId);
    expect(JSON.stringify(rows)).not.toContain(String(plan.planHash));
  });
});
