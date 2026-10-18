/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export const RESOURCE_KINDS = ['skill', 'agent', 'mcp', 'squad', 'knowledge', 'runtime_plugin'] as const;
export const VISIBILITIES = ['private', 'workspace', 'organization', 'public'] as const;
export const VERIFICATION_STATES = ['verified', 'unverified', 'rejected'] as const;
export const CONSUMER_TYPES = ['multica', 'dsh'] as const;
export const SCOPE_KINDS = ['workspace', 'profile', 'project'] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type VerificationState = (typeof VERIFICATION_STATES)[number];
export type ConsumerType = (typeof CONSUMER_TYPES)[number];
export type ScopeKind = (typeof SCOPE_KINDS)[number];

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const opaquePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const consumerIdPattern = /^[a-z][a-z0-9_-]{2,63}$/;
const scopeTokenPattern = /^[a-z][a-z0-9._-]{0,63}$/;
const instantPattern =
  /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/;

export class ShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapeError';
  }
}

export type IdentityMappingInput = {
  mappingId: string;
  ncSubjectId: string;
  consumerType: ConsumerType;
  consumerId: string;
  consumerTenantId: string;
  consumerSubjectId: string;
  targetScopeKind: ScopeKind;
  targetScopeId: string;
  allowedScope: string[];
  expiry: string;
  verification: VerificationState;
};

export function resourceIdentity(publisherSlug: string, name: string) {
  return `${publisherSlug}/${name}`;
}

export function etagFor(revision: number) {
  return String(revision);
}

export function parseSlug(value: unknown, label: string) {
  if (typeof value !== 'string' || !slugPattern.test(value)) {
    throw new ShapeError(`Invalid ${label}`);
  }
  return value;
}

export function parseOpaque(value: unknown, label: string) {
  if (typeof value !== 'string' || !opaquePattern.test(value)) {
    throw new ShapeError(`Invalid ${label}`);
  }
  return value;
}

export function parseEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ShapeError(`Invalid ${label}`);
  }
  return value as T;
}

export function optionalText(value: unknown, label: string, max = 400) {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || value.length > max) {
    throw new ShapeError(`Invalid ${label}`);
  }
  return value;
}

export function optionalObject(value: unknown, label: string) {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ShapeError(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

export function readPositiveInt(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

export function readRecord(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ShapeError('Invalid values');
  }
  return value as Record<string, unknown>;
}

export function parseMapping(value: unknown): IdentityMappingInput {
  const record = readRecord(value);
  if ('email' in record || record.linkMethod === 'email') {
    throw new ShapeError('Email is not an identity link');
  }
  const allowedScope = record.allowedScope;
  if (!Array.isArray(allowedScope) || allowedScope.length === 0) {
    throw new ShapeError('Invalid allowedScope');
  }
  const scopes = allowedScope.map((item) => {
    if (typeof item !== 'string' || !scopeTokenPattern.test(item)) {
      throw new ShapeError('Invalid allowedScope');
    }
    return item;
  });
  const expiry = record.expiry;
  if (typeof expiry !== 'string' || !instantPattern.test(expiry)) {
    throw new ShapeError('Invalid expiry');
  }
  const consumerId = record.consumerId;
  if (typeof consumerId !== 'string' || !consumerIdPattern.test(consumerId)) {
    throw new ShapeError('Invalid consumerId');
  }
  return {
    mappingId: parseOpaque(record.mappingId, 'mappingId'),
    ncSubjectId: parseOpaque(record.ncSubjectId, 'ncSubjectId'),
    consumerType: parseEnum(record.consumerType, CONSUMER_TYPES, 'consumerType'),
    consumerId,
    consumerTenantId: parseOpaque(record.consumerTenantId, 'consumerTenantId'),
    consumerSubjectId: parseOpaque(record.consumerSubjectId, 'consumerSubjectId'),
    targetScopeKind: parseEnum(record.targetScopeKind, SCOPE_KINDS, 'targetScopeKind'),
    targetScopeId: parseOpaque(record.targetScopeId, 'targetScopeId'),
    allowedScope: scopes,
    expiry,
    verification: parseEnum(record.verification, VERIFICATION_STATES, 'verification'),
  };
}

export function readPrecondition(header: string | undefined, expectedRevision: unknown) {
  const fromHeader = header == null || header === '' ? undefined : parsePresentedRevision(header);
  const fromBody = expectedRevision == null || expectedRevision === '' ? undefined : readPositiveInt(expectedRevision);
  if (expectedRevision != null && expectedRevision !== '' && fromBody == null) {
    throw new ShapeError('Invalid expectedRevision');
  }
  if (fromHeader != null && fromBody != null && fromHeader !== fromBody) {
    throw new ShapeError('Preconditions disagree');
  }
  return fromHeader ?? fromBody;
}

function parsePresentedRevision(header: string) {
  const weak = header.startsWith('W/') ? header.slice(2).trim() : header.trim();
  const quoted = weak.startsWith('"') && weak.endsWith('"') ? weak.slice(1, -1) : weak;
  const revision = readPositiveInt(quoted);
  if (revision == null) {
    throw new ShapeError('Invalid expectedRevision');
  }
  return revision;
}
