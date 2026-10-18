/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { createHash } from 'crypto';
import {
  CONSUMER_TYPES,
  parseEnum,
  parseOpaque,
  readPositiveInt,
  readRecord,
  type ConsumerType,
  type ScopeKind,
  type VerificationState,
  ShapeError,
} from './shape';

export const FEE_MODES = ['none', 'declared'] as const;
export const PREFLIGHT_STATUSES = ['ready', 'blocked', 'choose', 'unreadable'] as const;
export const PREFLIGHT_SOURCES = ['live', 'stub', 'unknown'] as const;

export type FeeMode = (typeof FEE_MODES)[number];
export type PreflightStatus = (typeof PREFLIGHT_STATUSES)[number];
export type PreflightSource = (typeof PREFLIGHT_SOURCES)[number];

export type DependencyLock = {
  digest: string;
  name: string;
  version: string;
};

export type CredentialRef = {
  purpose: string;
  ref: string;
};

export type PlanStep = {
  action: string;
  id: string;
};

export type PolicyInput = {
  allowedConsumerTypes: ConsumerType[];
  destinations: string[];
  feeMode: FeeMode;
  permissions: string[];
  policyId: string;
  requireVerifiedMapping: boolean;
};

export type ResolveInput = {
  credentialRefs: CredentialRef[];
  dependencies: DependencyLock[];
  mappingRowId: number;
  policyId: string;
  releaseRowId: number;
};

export type PreflightInput = {
  adapterVersion: string;
  expiresAt: string;
  preflightId: string;
  runtimeCapabilitiesDigest: string;
  source: PreflightSource;
  status: PreflightStatus;
  steps: PlanStep[];
};

export type FrozenPlanInput = {
  adapterVersion: string;
  consumerId: string;
  consumerSubjectId: string;
  consumerTenantId: string;
  consumerType: ConsumerType;
  credentialRefs: CredentialRef[];
  dependencyLock: DependencyLock[];
  destinations: string[];
  expiry: string;
  feeMode: FeeMode;
  mappingId: string;
  mappingRevision: number;
  permissions: string[];
  policyId: string;
  policyVersion: number;
  preflight: PreflightInput;
  releaseDigest: string;
  releaseId: string;
  releaseVersion: string;
  runtimeCapabilitiesDigest: string;
  targetScopeId: string;
  targetScopeKind: ScopeKind;
};

export type PlanSnapshot = {
  consumerType: ConsumerType;
  mappingRevision: number;
  permissionDigest: string;
  planHash: string;
  policyVersion: number;
  preflightDigest: string;
  releaseDigest: string;
};

export type LiveFacts = {
  allowedConsumerTypes: ConsumerType[];
  approvalPlanHash: string | null;
  approvalActive: boolean;
  mappingExpiry: string;
  mappingInvalidated: boolean;
  mappingRevision: number;
  mappingVerification: VerificationState;
  now: number;
  permissionDigest: string;
  policyActive: boolean;
  policyVersion: number;
  preflightDigest: string;
  preflightExpiry: string;
  releaseDigest: string;
  releaseState: string;
  requireVerifiedMapping: boolean;
};

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const dependencyNamePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;
const adapterVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const scopeTokenPattern = /^[a-z][a-z0-9._-]{0,63}$/;
const instantPattern =
  /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/;
const secretKeyPattern =
  /^(secret|secrets|token|password|apikey|api_key|accesskey|access_key|privatekey|private_key|authorization|credential)$/i;

const POLICY_KEYS = new Set([
  'allowedConsumerTypes',
  'destinations',
  'feeMode',
  'permissions',
  'policyId',
  'requireVerifiedMapping',
]);
const RESOLVE_KEYS = new Set(['credentialRefs', 'dependencies', 'mappingRowId', 'policyId', 'releaseRowId']);
const PREFLIGHT_KEYS = new Set([
  'adapterVersion',
  'expiresAt',
  'preflightId',
  'runtimeCapabilitiesDigest',
  'source',
  'status',
  'steps',
]);

export function digestOf(value: unknown) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function permissionDigestFor(permissions: readonly string[]) {
  return digestOf([...permissions].sort());
}

export function preflightDigestFor(preflight: PreflightInput) {
  return digestOf({
    adapterVersion: preflight.adapterVersion,
    expiresAt: preflight.expiresAt,
    preflightId: preflight.preflightId,
    runtimeCapabilitiesDigest: preflight.runtimeCapabilitiesDigest,
    source: preflight.source,
    status: preflight.status,
    steps: preflight.steps,
  });
}

export function freezeHash(input: FrozenPlanInput) {
  const permissions = [...input.permissions].sort();
  const preflightDigest = preflightDigestFor(input.preflight);
  return digestOf({
    adapterVersion: input.adapterVersion,
    consumerId: input.consumerId,
    consumerSubjectId: input.consumerSubjectId,
    consumerTenantId: input.consumerTenantId,
    consumerType: input.consumerType,
    credentialRefs: sortCredentials(input.credentialRefs),
    dependencyLock: sortLocks(input.dependencyLock),
    destinations: [...input.destinations].sort(),
    expectedChanges: {
      dependencyLock: sortLocks(input.dependencyLock),
      releaseId: input.releaseId,
      version: input.releaseVersion,
    },
    expiry: input.expiry,
    feeMode: input.feeMode,
    mappingId: input.mappingId,
    mappingRevision: input.mappingRevision,
    marketProtocolVersion: 'draft-1',
    permissionDigest: permissionDigestFor(permissions),
    permissions,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    preflightDigest,
    preflightId: input.preflight.preflightId,
    releaseDigest: input.releaseDigest,
    releaseId: input.releaseId,
    runtimeCapabilitiesDigest: input.runtimeCapabilitiesDigest,
    schemaVersion: 'draft-1',
    steps: input.preflight.steps,
    targetScopeId: input.targetScopeId,
    targetScopeKind: input.targetScopeKind,
  });
}

export function canFreeze(preflight: PreflightInput) {
  return preflight.status === 'ready' && preflight.source === 'live';
}

export function freshnessReasons(plan: PlanSnapshot, facts: LiveFacts) {
  const reasons: string[] = [];
  if (facts.mappingInvalidated || facts.mappingRevision !== plan.mappingRevision) {
    reasons.push('mapping_revision');
  }
  if (Date.parse(facts.mappingExpiry) <= facts.now) {
    reasons.push('mapping_expired');
  }
  if (!facts.policyActive || facts.policyVersion !== plan.policyVersion) {
    reasons.push('policy_version');
  }
  if (facts.permissionDigest !== plan.permissionDigest) {
    reasons.push('permissions');
  }
  const consumerAllowed = facts.allowedConsumerTypes.includes(plan.consumerType);
  const verifiedOk = !facts.requireVerifiedMapping || facts.mappingVerification === 'verified';
  if (!consumerAllowed || !verifiedOk) {
    reasons.push('policy');
  }
  if (facts.preflightDigest !== plan.preflightDigest || Date.parse(facts.preflightExpiry) <= facts.now) {
    reasons.push(facts.preflightDigest !== plan.preflightDigest ? 'preflight_digest' : 'preflight_expired');
  }
  if (facts.releaseState !== 'published') {
    reasons.push(facts.releaseState === 'revoked' ? 'release_revoked' : 'release_unpublished');
  }
  if (facts.releaseDigest !== plan.releaseDigest) {
    reasons.push('release_digest');
  }
  if (!facts.approvalActive || facts.approvalPlanHash !== plan.planHash) {
    reasons.push('approval_missing');
  }
  return reasons;
}

export function parsePolicy(value: unknown, defaults?: PolicyInput): PolicyInput {
  const record = readRecord(value);
  assertKeys(record, POLICY_KEYS, 'policy');
  const policyId = defaults && record.policyId == null ? defaults.policyId : parseOpaque(record.policyId, 'policyId');
  if (defaults && record.policyId != null && record.policyId !== defaults.policyId) {
    throw new ShapeError('Policy ID cannot change');
  }
  return {
    allowedConsumerTypes: parseConsumerTypes(
      record.allowedConsumerTypes == null ? defaults?.allowedConsumerTypes : record.allowedConsumerTypes,
    ),
    destinations: parseTokens(
      record.destinations == null ? defaults?.destinations : record.destinations,
      'destinations',
    ),
    feeMode: parseEnum(record.feeMode == null ? defaults?.feeMode : record.feeMode, FEE_MODES, 'feeMode'),
    permissions: parseTokens(record.permissions == null ? defaults?.permissions : record.permissions, 'permissions'),
    policyId,
    requireVerifiedMapping:
      record.requireVerifiedMapping == null
        ? defaults
          ? defaults.requireVerifiedMapping
          : true
        : parseFlag(record.requireVerifiedMapping),
  };
}

export function parseResolve(value: unknown): ResolveInput {
  rejectSecrets(value);
  const record = readRecord(value);
  assertKeys(record, RESOLVE_KEYS, 'plan');
  const releaseRowId = readPositiveInt(record.releaseRowId);
  const mappingRowId = readPositiveInt(record.mappingRowId);
  if (!releaseRowId || !mappingRowId) {
    throw new ShapeError('Invalid plan');
  }
  return {
    credentialRefs: parseCredentialRefs(record.credentialRefs),
    dependencies: parseDependencies(record.dependencies),
    mappingRowId,
    policyId: parseOpaque(record.policyId, 'policyId'),
    releaseRowId,
  };
}

export function parsePreflight(value: unknown): PreflightInput {
  rejectSecrets(value);
  const record = readRecord(value);
  assertKeys(record, PREFLIGHT_KEYS, 'preflight');
  const expiresAt = record.expiresAt;
  if (typeof expiresAt !== 'string' || !instantPattern.test(expiresAt)) {
    throw new ShapeError('Invalid expiresAt');
  }
  const runtimeCapabilitiesDigest = record.runtimeCapabilitiesDigest;
  if (typeof runtimeCapabilitiesDigest !== 'string' || !digestPattern.test(runtimeCapabilitiesDigest)) {
    throw new ShapeError('Invalid runtimeCapabilitiesDigest');
  }
  const adapterVersion = record.adapterVersion;
  if (typeof adapterVersion !== 'string' || !adapterVersionPattern.test(adapterVersion)) {
    throw new ShapeError('Invalid adapterVersion');
  }
  return {
    adapterVersion,
    expiresAt,
    preflightId: parseOpaque(record.preflightId, 'preflightId'),
    runtimeCapabilitiesDigest,
    source: parseEnum(record.source, PREFLIGHT_SOURCES, 'preflightSource'),
    status: parseEnum(record.status, PREFLIGHT_STATUSES, 'preflightStatus'),
    steps: parseSteps(record.steps),
  };
}

export function mergeDependencyLock(
  releaseName: string,
  releaseVersion: string,
  releaseDigest: string,
  extra: DependencyLock[],
) {
  const own = { digest: releaseDigest, name: releaseName, version: releaseVersion };
  for (const item of extra) {
    if (item.name === own.name && item.version === own.version && item.digest !== own.digest) {
      throw new ShapeError('Dependency lock disagrees with the release');
    }
  }
  return sortLocks([own, ...extra]);
}

export function rejectSecrets(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      rejectSecrets(item);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (secretKeyPattern.test(key)) {
      throw new ShapeError('Credentials must be references');
    }
    rejectSecrets(child);
  }
}

function parseDependencies(value: unknown): DependencyLock[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ShapeError('Invalid dependencies');
  }
  return value.map((item) => {
    const record = readRecord(item);
    assertKeys(record, new Set(['digest', 'name', 'version']), 'dependencies');
    if (typeof record.name !== 'string' || !dependencyNamePattern.test(record.name)) {
      throw new ShapeError('Invalid dependencies');
    }
    if (typeof record.version !== 'string' || !versionPattern.test(record.version)) {
      throw new ShapeError('Invalid dependencies');
    }
    if (typeof record.digest !== 'string' || !digestPattern.test(record.digest)) {
      throw new ShapeError('Invalid dependency digest');
    }
    return { digest: record.digest, name: record.name, version: record.version };
  });
}

function parseCredentialRefs(value: unknown): CredentialRef[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ShapeError('Invalid credentialRefs');
  }
  return value.map((item) => {
    const record = readRecord(item);
    assertKeys(record, new Set(['purpose', 'ref']), 'credentialRefs');
    return {
      purpose: parseOpaque(record.purpose, 'credentialPurpose'),
      ref: parseOpaque(record.ref, 'credentialRef'),
    };
  });
}

function parseSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ShapeError('Invalid steps');
  }
  return value.map((item) => {
    const record = readRecord(item);
    assertKeys(record, new Set(['action', 'id']), 'steps');
    return {
      action: parseOpaque(record.action, 'stepAction'),
      id: parseOpaque(record.id, 'stepId'),
    };
  });
}

function parseConsumerTypes(value: unknown): ConsumerType[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ShapeError('Invalid allowedConsumerTypes');
  }
  const types = value.map((item) => parseEnum(item, CONSUMER_TYPES, 'allowedConsumerTypes'));
  return [...new Set(types)].sort();
}

function parseTokens(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new ShapeError(`Invalid ${label}`);
  }
  const tokens = value.map((item) => {
    if (typeof item !== 'string' || !scopeTokenPattern.test(item)) {
      throw new ShapeError(`Invalid ${label}`);
    }
    return item;
  });
  return [...new Set(tokens)].sort();
}

function parseFlag(value: unknown) {
  if (typeof value !== 'boolean') {
    throw new ShapeError('Invalid requireVerifiedMapping');
  }
  return value;
}

function assertKeys(record: Record<string, unknown>, allowed: Set<string>, label: string) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ShapeError(`Invalid ${label}`);
    }
  }
}

function compareText(left: string, right: string) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function sortLocks(locks: DependencyLock[]) {
  const seen = new Set<string>();
  const sorted = [...locks].sort(
    (left, right) =>
      compareText(left.name, right.name) ||
      compareText(left.version, right.version) ||
      compareText(left.digest, right.digest),
  );
  const result: DependencyLock[] = [];
  for (const lock of sorted) {
    const key = `${lock.name}\0${lock.version}\0${lock.digest}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(lock);
  }
  return result;
}

function sortCredentials(refs: CredentialRef[]) {
  const seen = new Set<string>();
  const sorted = [...refs].sort(
    (left, right) => compareText(left.ref, right.ref) || compareText(left.purpose, right.purpose),
  );
  const result: CredentialRef[] = [];
  for (const ref of sorted) {
    const key = `${ref.ref}\0${ref.purpose}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(ref);
  }
  return result;
}
