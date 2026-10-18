/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { randomBytes } from 'crypto';
import actions, { Context, Next } from '@nocobase/actions';
import { fail, findInTenant, isUniqueError, principalFrom, withShape } from './guard';
import {
  canFreeze,
  freezeHash,
  freshnessReasons,
  mergeDependencyLock,
  parsePolicy,
  parsePreflight,
  parseResolve,
  permissionDigestFor,
  preflightDigestFor,
  rejectSecrets,
  type FrozenPlanInput,
  type LiveFacts,
  type PlanSnapshot,
  type PolicyInput,
  type PreflightInput,
} from './plan-document';
import { readPositiveInt, readPrecondition, readRecord, type ConsumerType, type VerificationState } from './shape';

type Row = {
  get(key: string): unknown;
};

type DbTransaction = object;

export async function createPolicy(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const principal = principalFrom(ctx);
    const input = parsePolicy(clientValues(ctx));
    ctx.action.params.values = policyValues(input, principal.ncTenantId, 1, true);
    try {
      return await actions.create(ctx, next);
    } catch (error) {
      if (isUniqueError(error)) {
        fail(ctx, 409, 'Policy already exists');
      }
      throw error;
    }
  });
}

export async function revisePolicy(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const id = readPositiveInt(ctx.action.params.filterByTk);
    if (!id) {
      fail(ctx, 400, 'Invalid policy');
    }
    const values = clientValues(ctx);
    const expected = readPrecondition(ctx.get('If-Match'), values.expectedRevision);
    if (expected == null) {
      fail(ctx, 428, 'Policy revision is required');
    }
    const { principal, row } = await findInTenant(ctx, 'marketPolicies', id);
    if (!row || !isOn(row.get('active'))) {
      fail(ctx, 404, 'Policy not found');
    }
    if (Number(row.get('policyVersion')) !== expected) {
      fail(ctx, 409, 'Stale policy version');
    }
    const previous = policyFromRow(row);
    const input = parsePolicy(withoutRevision(values), previous);
    const nextVersion = expected + 1;
    const reason = policyChangeReason(previous, input);
    let createdId = 0;
    await ctx.db.sequelize.transaction(async (transaction) => {
      const [affected] = await ctx.db.getCollection('marketPolicies').model.update(
        { active: false },
        {
          where: { id, ncTenantId: principal.ncTenantId, policyVersion: expected, active: true },
          transaction,
        },
      );
      if (affected !== 1) {
        fail(ctx, 409, 'Stale policy version');
      }
      const created = (await ctx.db.getRepository('marketPolicies').create({
        values: policyValues(input, principal.ncTenantId, nextVersion, true),
        context: ctx,
        transaction,
      })) as Row;
      createdId = Number(created.get('id'));
      await invalidateActiveApprovals(ctx, { policyId: input.policyId }, reason, transaction);
    });
    ctx.body = await ctx.db.getRepository('marketPolicies').findOne({ filterByTk: createdId });
    await next();
  });
}

export async function resolvePlan(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const principal = principalFrom(ctx);
    const presented = clientValues(ctx);
    delete presented.planHash;
    const input = parseResolve(presented);
    const release = await loadRelease(ctx, principal.ncTenantId, input.releaseRowId);
    if (String(release.get('state')) !== 'published') {
      fail(ctx, 409, 'Release is not published');
    }
    const mapping = await loadMapping(ctx, principal.ncTenantId, input.mappingRowId);
    assertMappingUsable(ctx, mapping);
    const policy = await loadActivePolicy(ctx, principal.ncTenantId, input.policyId);
    assertPolicyAllows(ctx, policy, String(mapping.get('consumerType')), String(mapping.get('verification')));
    const releaseName = manifestName(release);
    const dependencyLock = mergeDependencyLock(
      releaseName,
      String(release.get('version')),
      String(release.get('digest')),
      input.dependencies,
    );
    const permissions = stringList(policy.get('permissions'));
    const destinations = stringList(policy.get('destinations'));
    const created = await ctx.db.getRepository('marketPlans').create({
      values: {
        ncTenantId: principal.ncTenantId,
        planId: token('plan'),
        state: 'expected',
        releaseRowId: release.get('id'),
        releaseId: String(release.get('releaseId')),
        releaseDigest: String(release.get('digest')),
        releaseVersion: String(release.get('version')),
        mappingRowId: mapping.get('id'),
        mappingId: String(mapping.get('mappingId')),
        mappingRevision: Number(mapping.get('revision')),
        policyRowId: policy.get('id'),
        policyId: String(policy.get('policyId')),
        policyVersion: Number(policy.get('policyVersion')),
        permissionDigest: String(policy.get('permissionDigest')),
        consumerType: String(mapping.get('consumerType')),
        consumerId: String(mapping.get('consumerId')),
        consumerTenantId: String(mapping.get('consumerTenantId')),
        consumerSubjectId: String(mapping.get('consumerSubjectId')),
        targetScopeKind: String(mapping.get('targetScopeKind')),
        targetScopeId: String(mapping.get('targetScopeId')),
        expiry: String(mapping.get('expiry')),
        feeMode: String(policy.get('feeMode')),
        dependencyLock,
        credentialRefs: input.credentialRefs,
        permissions,
        destinations,
        expectedChanges: {
          dependencyLock,
          releaseId: String(release.get('releaseId')),
          version: String(release.get('version')),
        },
        steps: null,
      },
      context: ctx,
    });
    ctx.body = created;
    await next();
  });
}

export async function finalizePlan(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const { principal, row } = await loadPlan(ctx);
    if (String(row.get('state')) !== 'expected') {
      fail(ctx, 409, 'Plan is already frozen');
    }
    const values = clientValues(ctx);
    rejectSecrets(values);
    const preflight = parsePreflight(values.preflight);
    await storePreflight(ctx, principal.ncTenantId, row, preflight);
    if (!canFreeze(preflight)) {
      fail(ctx, 409, 'Preflight is not ready');
    }
    const hash = freezeHash(frozenInput(row, preflight));
    const [affected] = await ctx.db.getCollection('marketPlans').model.update(
      {
        state: 'frozen',
        adapterVersion: preflight.adapterVersion,
        runtimeCapabilitiesDigest: preflight.runtimeCapabilitiesDigest,
        preflightId: preflight.preflightId,
        preflightDigest: preflightDigestFor(preflight),
        preflightExpiry: preflight.expiresAt,
        steps: preflight.steps,
        planHash: hash,
      },
      { where: { id: row.get('id'), ncTenantId: principal.ncTenantId, state: 'expected' } },
    );
    if (affected !== 1) {
      fail(ctx, 409, 'Plan is already frozen');
    }
    ctx.body = await ctx.db.getRepository('marketPlans').findOne({ filterByTk: row.get('id') });
    await next();
  });
}

export async function recordPreflight(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const { principal, row } = await loadPlan(ctx);
    if (String(row.get('state')) !== 'frozen') {
      fail(ctx, 409, 'Plan is not frozen');
    }
    const values = clientValues(ctx);
    rejectSecrets(values);
    const preflight = parsePreflight(values.preflight);
    const stored = await storePreflight(ctx, principal.ncTenantId, row, preflight);
    if (String(stored.get('digest')) !== String(row.get('preflightDigest'))) {
      await invalidateActiveApprovals(ctx, { planRowId: row.get('id') }, 'preflight_digest');
    }
    ctx.body = stored;
    await next();
  });
}

export async function approvePlan(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const { principal, row } = await loadPlan(ctx);
    if (String(row.get('state')) !== 'frozen' || !row.get('planHash')) {
      fail(ctx, 409, 'Plan is not frozen');
    }
    const presented = clientValues(ctx).planHash;
    if (presented !== String(row.get('planHash'))) {
      fail(ctx, 409, 'Plan hash mismatch');
    }
    const facts = await liveFacts(ctx, principal.ncTenantId, row);
    const reasons = freshnessReasons(snapshot(row), {
      ...facts,
      approvalActive: true,
      approvalPlanHash: String(row.get('planHash')),
    });
    if (reasons.length > 0) {
      await invalidateActiveApprovals(ctx, { planRowId: row.get('id') }, reasons.join(','));
      fail(ctx, 409, 'Stale approval');
    }
    const existing = await activeApproval(ctx, principal.ncTenantId, Number(row.get('id')));
    if (existing) {
      const sameApprover = Number(existing.get('approverUserId')) === principal.userId;
      if (sameApprover && existing.get('planHash') === row.get('planHash')) {
        ctx.body = existing;
        await next();
        return;
      }
      fail(ctx, 409, 'Approval already exists');
    }
    ctx.body = await ctx.db.getRepository('marketApprovals').create({
      values: {
        ncTenantId: principal.ncTenantId,
        planRowId: row.get('id'),
        planId: String(row.get('planId')),
        planHash: String(row.get('planHash')),
        approvalId: token('apr'),
        state: 'active',
        releaseRowId: row.get('releaseRowId'),
        mappingId: String(row.get('mappingId')),
        mappingRevision: Number(row.get('mappingRevision')),
        policyId: String(row.get('policyId')),
        policyVersion: Number(row.get('policyVersion')),
        permissionDigest: String(row.get('permissionDigest')),
        preflightDigest: String(row.get('preflightDigest')),
        releaseDigest: String(row.get('releaseDigest')),
        approverUserId: principal.userId,
        expiry: String(row.get('expiry')),
      },
      context: ctx,
    });
    await next();
  });
}

export async function planEligibility(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const { principal, row } = await loadPlan(ctx);
    if (String(row.get('state')) !== 'frozen' || !row.get('planHash')) {
      fail(ctx, 409, 'Plan is not frozen');
    }
    const facts = await liveFacts(ctx, principal.ncTenantId, row);
    const reasons = freshnessReasons(snapshot(row), facts);
    if (reasons.length > 0) {
      await ctx.db
        .getCollection('marketApprovals')
        .model.update(
          { state: 'invalidated', invalidatedReason: reasons.join(',') },
          { where: { ncTenantId: principal.ncTenantId, planRowId: row.get('id'), state: 'active' } },
        );
      const prior = await ctx.db.getRepository('marketApprovals').findOne({
        filter: { ncTenantId: principal.ncTenantId, planRowId: row.get('id') },
        sort: ['-id'],
      });
      if (prior) {
        await ctx.db
          .getCollection('marketApprovals')
          .model.update(
            { invalidatedReason: reasons.join(',') },
            { where: { id: (prior as Row).get('id'), ncTenantId: principal.ncTenantId } },
          );
      }
      fail(ctx, 403, 'Distribution ineligible');
    }
    const approval = await activeApproval(ctx, principal.ncTenantId, Number(row.get('id')));
    ctx.body = {
      approvalId: approval ? String(approval.get('approvalId')) : null,
      distribution: 'allowed',
      eligible: true,
      planHash: String(row.get('planHash')),
      reasons: [],
    };
    await next();
  });
}

export async function invalidateActiveApprovals(
  ctx: Context,
  filter: Record<string, unknown>,
  reason: string,
  transaction?: DbTransaction,
) {
  const principal = principalFrom(ctx);
  await ctx.db.getCollection('marketApprovals').model.update(
    { state: 'invalidated', invalidatedReason: reason },
    {
      where: { ...filter, ncTenantId: principal.ncTenantId, state: 'active' },
      transaction,
    },
  );
}

function policyValues(input: PolicyInput, ncTenantId: string, policyVersion: number, active: boolean) {
  return {
    ncTenantId,
    policyId: input.policyId,
    policyVersion,
    active,
    requireVerifiedMapping: input.requireVerifiedMapping,
    allowedConsumerTypes: input.allowedConsumerTypes,
    permissions: input.permissions,
    permissionDigest: permissionDigestFor(input.permissions),
    destinations: input.destinations,
    feeMode: input.feeMode,
  };
}

function policyFromRow(row: Row): PolicyInput {
  return {
    allowedConsumerTypes: stringList(row.get('allowedConsumerTypes')) as ConsumerType[],
    destinations: stringList(row.get('destinations')),
    feeMode: String(row.get('feeMode')) as PolicyInput['feeMode'],
    permissions: stringList(row.get('permissions')),
    policyId: String(row.get('policyId')),
    requireVerifiedMapping: isOn(row.get('requireVerifiedMapping')),
  };
}

function policyChangeReason(previous: PolicyInput, nextPolicy: PolicyInput) {
  const reasons = ['policy_version'];
  if (permissionDigestFor(previous.permissions) !== permissionDigestFor(nextPolicy.permissions)) {
    reasons.push('permissions');
  }
  return reasons.join(',');
}

function clientValues(ctx: Context) {
  const values = readRecord(ctx.action.params.values);
  delete values.ncTenantId;
  return values;
}

function withoutRevision(values: Record<string, unknown>) {
  const nextValues = { ...values };
  delete nextValues.expectedRevision;
  return nextValues;
}

function assertMappingUsable(ctx: Context, mapping: Row) {
  if (isOn(mapping.get('invalidated')) || Date.parse(String(mapping.get('expiry'))) <= Date.now()) {
    fail(ctx, 409, 'Mapping is not usable');
  }
}

function assertPolicyAllows(ctx: Context, policy: Row, consumerType: string, verification: string) {
  const allowed = stringList(policy.get('allowedConsumerTypes'));
  if (!allowed.includes(consumerType)) {
    fail(ctx, 409, 'Consumer is outside policy');
  }
  if (isOn(policy.get('requireVerifiedMapping')) && verification !== 'verified') {
    fail(ctx, 409, 'Mapping is not verified');
  }
}

function isOn(value: unknown) {
  return value === true || value === 1;
}

async function loadRelease(ctx: Context, ncTenantId: string, id: number) {
  const row = (await ctx.db.getRepository('marketReleases').findOne({
    filterByTk: id,
    filter: { ncTenantId },
  })) as Row | null;
  if (!row) {
    fail(ctx, 404, 'Release not found');
  }
  return row;
}

async function loadMapping(ctx: Context, ncTenantId: string, id: number) {
  const row = (await ctx.db.getRepository('marketIdentityMappings').findOne({
    filterByTk: id,
    filter: { ncTenantId },
  })) as Row | null;
  if (!row) {
    fail(ctx, 404, 'Mapping not found');
  }
  return row;
}

async function loadActivePolicy(ctx: Context, ncTenantId: string, policyId: string) {
  const row = (await ctx.db.getRepository('marketPolicies').findOne({
    filter: { ncTenantId, policyId, active: true },
  })) as Row | null;
  if (!row) {
    fail(ctx, 404, 'Policy not found');
  }
  return row;
}

async function loadPlan(ctx: Context) {
  const id = readPositiveInt(ctx.action.params.filterByTk);
  if (!id) {
    fail(ctx, 400, 'Invalid plan');
  }
  const { principal, row } = await findInTenant(ctx, 'marketPlans', id);
  if (!row) {
    fail(ctx, 404, 'Plan not found');
  }
  return { principal, row };
}

function manifestName(release: Row) {
  const manifest = release.get('manifest');
  if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
    const name = (manifest as Record<string, unknown>).name;
    if (typeof name === 'string' && name.length > 0) {
      return name;
    }
  }
  return String(release.get('resourceId'));
}

function frozenInput(row: Row, preflight: PreflightInput): FrozenPlanInput {
  return {
    adapterVersion: preflight.adapterVersion,
    consumerId: String(row.get('consumerId')),
    consumerSubjectId: String(row.get('consumerSubjectId')),
    consumerTenantId: String(row.get('consumerTenantId')),
    consumerType: String(row.get('consumerType')) as ConsumerType,
    credentialRefs: credentialList(row.get('credentialRefs')),
    dependencyLock: lockList(row.get('dependencyLock')),
    destinations: stringList(row.get('destinations')),
    expiry: String(row.get('expiry')),
    feeMode: String(row.get('feeMode')) as FrozenPlanInput['feeMode'],
    mappingId: String(row.get('mappingId')),
    mappingRevision: Number(row.get('mappingRevision')),
    permissions: stringList(row.get('permissions')),
    policyId: String(row.get('policyId')),
    policyVersion: Number(row.get('policyVersion')),
    preflight,
    releaseDigest: String(row.get('releaseDigest')),
    releaseId: String(row.get('releaseId')),
    releaseVersion: String(row.get('releaseVersion')),
    runtimeCapabilitiesDigest: preflight.runtimeCapabilitiesDigest,
    targetScopeId: String(row.get('targetScopeId')),
    targetScopeKind: String(row.get('targetScopeKind')) as FrozenPlanInput['targetScopeKind'],
  };
}

async function storePreflight(ctx: Context, ncTenantId: string, plan: Row, preflight: PreflightInput) {
  const digest = preflightDigestFor(preflight);
  const existing = (await ctx.db.getRepository('marketPreflights').findOne({
    filter: { ncTenantId, planRowId: plan.get('id'), preflightId: preflight.preflightId },
  })) as Row | null;
  if (existing) {
    if (String(existing.get('digest')) !== digest) {
      fail(ctx, 409, 'Preflight already recorded');
    }
    return existing;
  }
  return (await ctx.db.getRepository('marketPreflights').create({
    values: {
      ncTenantId,
      planRowId: plan.get('id'),
      planId: String(plan.get('planId')),
      preflightId: preflight.preflightId,
      digest,
      status: preflight.status,
      source: preflight.source,
      expiresAt: preflight.expiresAt,
      report: preflight,
    },
    context: ctx,
  })) as Row;
}

async function liveFacts(ctx: Context, ncTenantId: string, plan: Row): Promise<LiveFacts> {
  const mappingRows = (await ctx.db.getRepository('marketIdentityMappings').find({
    filter: { ncTenantId, mappingId: plan.get('mappingId'), invalidated: false },
    sort: ['-revision'],
    limit: 1,
  })) as Row[];
  const mapping = mappingRows[0];
  const policy = (await ctx.db.getRepository('marketPolicies').findOne({
    filter: { ncTenantId, policyId: plan.get('policyId'), active: true },
  })) as Row | null;
  const release = (await ctx.db.getRepository('marketReleases').findOne({
    filterByTk: plan.get('releaseRowId'),
    filter: { ncTenantId },
  })) as Row | null;
  const preflightRows = (await ctx.db.getRepository('marketPreflights').find({
    filter: { ncTenantId, planRowId: plan.get('id') },
    sort: ['-id'],
    limit: 1,
  })) as Row[];
  const preflight = preflightRows[0];
  const approval = await activeApproval(ctx, ncTenantId, Number(plan.get('id')));
  return {
    allowedConsumerTypes: policy ? (stringList(policy.get('allowedConsumerTypes')) as ConsumerType[]) : [],
    approvalActive: approval != null,
    approvalPlanHash: approval ? String(approval.get('planHash')) : null,
    mappingExpiry: mapping ? String(mapping.get('expiry')) : '2000-01-01T00:00:00Z',
    mappingInvalidated: !mapping,
    mappingRevision: mapping ? Number(mapping.get('revision')) : -1,
    mappingVerification: mapping ? (String(mapping.get('verification')) as VerificationState) : 'rejected',
    now: Date.now(),
    permissionDigest: policy ? String(policy.get('permissionDigest')) : '',
    policyActive: policy != null,
    policyVersion: policy ? Number(policy.get('policyVersion')) : -1,
    preflightDigest: preflight ? String(preflight.get('digest')) : '',
    preflightExpiry: preflight ? String(preflight.get('expiresAt')) : '2000-01-01T00:00:00Z',
    releaseDigest: release ? String(release.get('digest')) : '',
    releaseState: release ? String(release.get('state')) : 'missing',
    requireVerifiedMapping: policy ? isOn(policy.get('requireVerifiedMapping')) : true,
  };
}

function snapshot(plan: Row): PlanSnapshot {
  return {
    consumerType: String(plan.get('consumerType')) as ConsumerType,
    mappingRevision: Number(plan.get('mappingRevision')),
    permissionDigest: String(plan.get('permissionDigest')),
    planHash: String(plan.get('planHash')),
    policyVersion: Number(plan.get('policyVersion')),
    preflightDigest: String(plan.get('preflightDigest')),
    releaseDigest: String(plan.get('releaseDigest')),
  };
}

async function activeApproval(ctx: Context, ncTenantId: string, planRowId: number) {
  return (await ctx.db.getRepository('marketApprovals').findOne({
    filter: { ncTenantId, planRowId, state: 'active' },
  })) as Row | null;
}

function token(prefix: string) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function stringList(value: unknown) {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is string => typeof item === 'string');
}

function credentialList(value: unknown): FrozenPlanInput['credentialRefs'] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.ref !== 'string' || typeof record.purpose !== 'string') {
      return [];
    }
    return [{ purpose: record.purpose, ref: record.ref }];
  });
}

function lockList(value: unknown): FrozenPlanInput['dependencyLock'] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.version !== 'string' || typeof record.digest !== 'string') {
      return [];
    }
    return [{ digest: record.digest, name: record.name, version: record.version }];
  });
}

function jsonValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
