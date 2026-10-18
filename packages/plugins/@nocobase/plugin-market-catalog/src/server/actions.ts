/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import actions, { Context, Next } from '@nocobase/actions';
import { fail, findInTenant, isUniqueError, principalFrom, withShape } from './guard';
import {
  etagFor,
  optionalObject,
  optionalText,
  parseEnum,
  parseMapping,
  parseOpaque,
  parseSlug,
  readPositiveInt,
  readPrecondition,
  readRecord,
  resourceIdentity,
  RESOURCE_KINDS,
  VISIBILITIES,
  type IdentityMappingInput,
} from './shape';

type Row = {
  get(key: string): unknown;
  toJSON(): Record<string, unknown>;
};

const PROTOCOL_VERSION = 'draft-1';

export async function createPublisher(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const values = readRecord(ctx.action.params.values);
    const publisherSlug = parseSlug(values.publisherSlug, 'publisherSlug');
    const displayName = optionalText(values.displayName, 'displayName', 200);
    if (!displayName) {
      fail(ctx, 400, 'Invalid displayName');
    }
    ctx.action.params.values = {
      publisherSlug,
      displayName,
      verificationStatus: 'unverified',
      ncTenantId: principalFrom(ctx).ncTenantId,
    };
    try {
      return await actions.create(ctx, next);
    } catch (error) {
      if (isUniqueError(error)) {
        fail(ctx, 409, 'Publisher already exists');
      }
      throw error;
    }
  });
}

export async function updatePublisher(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const values = readRecord(ctx.action.params.values);
    const displayName = optionalText(values.displayName, 'displayName', 200);
    if (!displayName) {
      fail(ctx, 400, 'Invalid displayName');
    }
    ctx.action.params.values = {
      displayName,
    };
    return actions.update(ctx, next);
  });
}

export async function transferOwnership(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const id = readPositiveInt(ctx.action.params.filterByTk);
    const toUserId = readPositiveInt(readRecord(ctx.action.params.values).toUserId);
    if (!id || !toUserId) {
      fail(ctx, 400, 'Invalid transfer');
    }
    const { principal, row } = await findInTenant(ctx, 'marketPublishers', id);
    if (!row) {
      fail(ctx, 404, 'Publisher not found');
    }
    const ownerUserId = Number(row.get('ownerUserId'));
    if (ownerUserId !== principal.userId) {
      fail(ctx, 403, 'Only the owner can transfer ownership');
    }
    const target = (await ctx.db.getRepository('marketPrincipals').findOne({
      filter: { userId: toUserId, ncTenantId: principal.ncTenantId },
    })) as Row | null;
    if (!target) {
      fail(ctx, 400, 'Target principal is not in this tenant');
    }
    await ctx.db.sequelize.transaction(async (transaction) => {
      const [affected] = await ctx.db.getCollection('marketPublishers').model.update(
        { ownerUserId: toUserId },
        {
          where: { id, ownerUserId, ncTenantId: principal.ncTenantId },
          transaction,
        },
      );
      if (affected !== 1) {
        fail(ctx, 409, 'Ownership changed');
      }
      await ctx.db.getRepository('marketOwnershipEvents').create({
        values: {
          ncTenantId: principal.ncTenantId,
          publisherId: id,
          fromUserId: ownerUserId,
          toUserId,
          actorUserId: principal.userId,
        },
        context: ctx,
        transaction,
      });
    });
    ctx.body = await ctx.db.getRepository('marketPublishers').findOne({
      filterByTk: id,
    });
    await next();
  });
}

export async function createResource(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const principal = principalFrom(ctx);
    const values = readRecord(ctx.action.params.values);
    const publisherId = readPositiveInt(values.publisherId);
    const name = parseSlug(values.name, 'name');
    const sourceKey =
      values.sourceKey == null || values.sourceKey === '' ? 'local' : parseOpaque(values.sourceKey, 'sourceKey');
    const kind = parseEnum(values.kind, RESOURCE_KINDS, 'kind');
    const visibility =
      values.visibility == null || values.visibility === ''
        ? 'private'
        : parseEnum(values.visibility, VISIBILITIES, 'visibility');
    if (!publisherId) {
      fail(ctx, 400, 'Invalid publisherId');
    }
    const publisher = (await ctx.db.getRepository('marketPublishers').findOne({
      filterByTk: publisherId,
      filter: { ncTenantId: principal.ncTenantId },
    })) as Row | null;
    if (!publisher) {
      fail(ctx, 404, 'Publisher not found');
    }
    ctx.action.params.values = {
      publisherId,
      name,
      sourceKey,
      resourceId: resourceIdentity(String(publisher.get('publisherSlug')), name),
      kind,
      visibility,
      summary: optionalText(values.summary, 'summary'),
      ncTenantId: principal.ncTenantId,
    };
    try {
      return await actions.create(ctx, next);
    } catch (error) {
      if (isUniqueError(error)) {
        fail(ctx, 409, 'Resource already exists');
      }
      throw error;
    }
  });
}

export async function updateResource(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const values = readRecord(ctx.action.params.values);
    const visibility = values.visibility == null ? undefined : parseEnum(values.visibility, VISIBILITIES, 'visibility');
    ctx.action.params.values = {
      ...(visibility ? { visibility } : {}),
      ...(values.summary !== undefined ? { summary: optionalText(values.summary, 'summary') } : {}),
    };
    return actions.update(ctx, next);
  });
}

export async function createDraft(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const principal = principalFrom(ctx);
    const values = readRecord(ctx.action.params.values);
    const resourceRowId = readPositiveInt(values.resourceRowId);
    if (!resourceRowId) {
      fail(ctx, 400, 'Invalid resourceRowId');
    }
    const resource = (await ctx.db.getRepository('marketResources').findOne({
      filterByTk: resourceRowId,
      filter: { ncTenantId: principal.ncTenantId },
    })) as Row | null;
    if (!resource) {
      fail(ctx, 404, 'Resource not found');
    }
    ctx.action.params.values = {
      resourceRowId,
      resourceId: String(resource.get('resourceId')),
      revision: 1,
      etag: etagFor(1),
      title: optionalText(values.title, 'title', 200),
      summary: optionalText(values.summary, 'summary'),
      body: optionalObject(values.body, 'body'),
      ncTenantId: principal.ncTenantId,
    };
    try {
      return await actions.create(ctx, next);
    } catch (error) {
      if (isUniqueError(error)) {
        fail(ctx, 409, 'Draft already exists');
      }
      throw error;
    }
  });
}

export async function updateDraft(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const id = readPositiveInt(ctx.action.params.filterByTk);
    if (!id) {
      fail(ctx, 400, 'Invalid draft');
    }
    const header = ctx.get('If-Match');
    const values = readRecord(ctx.action.params.values);
    const expected = readPrecondition(header, values.expectedRevision);
    if (expected == null) {
      fail(ctx, 428, 'Draft revision is required');
    }
    const { principal, row } = await findInTenant(ctx, 'marketDrafts', id);
    if (!row) {
      fail(ctx, 404, 'Draft not found');
    }
    if (Number(row.get('revision')) !== expected) {
      fail(ctx, 409, 'Stale draft revision');
    }
    const nextRevision = expected + 1;
    const patch: Record<string, unknown> = {
      revision: nextRevision,
      etag: etagFor(nextRevision),
    };
    if (values.title !== undefined) {
      patch.title = optionalText(values.title, 'title', 200);
    }
    if (values.summary !== undefined) {
      patch.summary = optionalText(values.summary, 'summary');
    }
    if (values.body !== undefined) {
      patch.body = optionalObject(values.body, 'body');
    }
    const [affected] = await ctx.db.getCollection('marketDrafts').model.update(patch, {
      where: {
        id,
        revision: expected,
        ncTenantId: principal.ncTenantId,
      },
    });
    if (affected !== 1) {
      fail(ctx, 409, 'Stale draft revision');
    }
    ctx.body = await ctx.db.getRepository('marketDrafts').findOne({ filterByTk: id });
    await next();
  });
}

export async function createMapping(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const principal = principalFrom(ctx);
    const input = parseMapping(ctx.action.params.values);
    await assertSubjectInTenant(ctx, principal.ncTenantId, input.ncSubjectId);
    ctx.action.params.values = mappingValues(input, principal.ncTenantId, 1, false);
    try {
      return await actions.create(ctx, next);
    } catch (error) {
      if (isUniqueError(error)) {
        fail(ctx, 409, 'Mapping revision already exists');
      }
      throw error;
    }
  });
}

export async function reviseMapping(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const id = readPositiveInt(ctx.action.params.filterByTk);
    if (!id) {
      fail(ctx, 400, 'Invalid mapping');
    }
    const header = ctx.get('If-Match');
    const values = readRecord(ctx.action.params.values);
    const expected = readPrecondition(header, values.expectedRevision);
    if (expected == null) {
      fail(ctx, 428, 'Mapping revision is required');
    }
    const { principal, row } = await findInTenant(ctx, 'marketIdentityMappings', id);
    if (!row) {
      fail(ctx, 404, 'Mapping not found');
    }
    if (row.get('invalidated') === true || Number(row.get('revision')) !== expected) {
      fail(ctx, 409, 'Stale mapping revision');
    }
    const current = mappingFromRow(row);
    const input = parseMapping({ ...current, ...withoutControl(values) });
    await assertSubjectInTenant(ctx, principal.ncTenantId, input.ncSubjectId);
    if (input.mappingId !== current.mappingId) {
      fail(ctx, 400, 'Mapping ID cannot change');
    }
    const nextRevision = expected + 1;
    await ctx.db.sequelize.transaction(async (transaction) => {
      const [affected] = await ctx.db.getCollection('marketIdentityMappings').model.update(
        { invalidated: true },
        {
          where: {
            id,
            revision: expected,
            invalidated: false,
            ncTenantId: principal.ncTenantId,
          },
          transaction,
        },
      );
      if (affected !== 1) {
        fail(ctx, 409, 'Stale mapping revision');
      }
      await ctx.db.getRepository('marketIdentityMappings').create({
        values: mappingValues(input, principal.ncTenantId, nextRevision, false),
        context: ctx,
        transaction,
      });
    });
    ctx.body = await ctx.db.getRepository('marketIdentityMappings').findOne({
      filter: {
        ncTenantId: principal.ncTenantId,
        mappingId: input.mappingId,
        revision: nextRevision,
      },
    });
    await next();
  });
}

export async function createPrincipal(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const principal = principalFrom(ctx);
    const values = readRecord(ctx.action.params.values);
    const userId = readPositiveInt(values.userId);
    const ncSubjectId = parseOpaque(values.ncSubjectId, 'ncSubjectId');
    if (!userId) {
      fail(ctx, 400, 'Invalid userId');
    }
    const taken = (await ctx.db.getRepository('marketPrincipals').findOne({
      filter: { ncTenantId: principal.ncTenantId, ncSubjectId },
    })) as Row | null;
    if (taken) {
      fail(ctx, 409, 'Subject is already bound');
    }
    ctx.action.params.values = {
      userId,
      ncSubjectId,
      ncTenantId: principal.ncTenantId,
    };
    try {
      return await actions.create(ctx, next);
    } catch (error) {
      if (isUniqueError(error)) {
        fail(ctx, 409, 'User is already bound');
      }
      throw error;
    }
  });
}

async function assertSubjectInTenant(ctx: Context, ncTenantId: string, ncSubjectId: string) {
  const subject = (await ctx.db.getRepository('marketPrincipals').findOne({
    filter: { ncTenantId, ncSubjectId },
  })) as Row | null;
  if (!subject) {
    fail(ctx, 400, 'Subject is not in this tenant');
  }
}

function mappingValues(input: IdentityMappingInput, ncTenantId: string, revision: number, invalidated: boolean) {
  return {
    ...input,
    ncTenantId,
    revision,
    invalidated,
    marketProtocolVersion: PROTOCOL_VERSION,
    schemaVersion: PROTOCOL_VERSION,
  };
}

function mappingFromRow(row: Row): IdentityMappingInput {
  const allowedScope = row.get('allowedScope');
  return {
    mappingId: String(row.get('mappingId')),
    ncSubjectId: String(row.get('ncSubjectId')),
    consumerType: row.get('consumerType') as IdentityMappingInput['consumerType'],
    consumerId: String(row.get('consumerId')),
    consumerTenantId: String(row.get('consumerTenantId')),
    consumerSubjectId: String(row.get('consumerSubjectId')),
    targetScopeKind: row.get('targetScopeKind') as IdentityMappingInput['targetScopeKind'],
    targetScopeId: String(row.get('targetScopeId')),
    allowedScope: Array.isArray(allowedScope) ? allowedScope.map((item) => String(item)) : [],
    expiry: String(row.get('expiry')),
    verification: row.get('verification') as IdentityMappingInput['verification'],
  };
}

function withoutControl(values: Record<string, unknown>) {
  const next = { ...values };
  delete next.expectedRevision;
  delete next.revision;
  delete next.invalidated;
  delete next.actor;
  delete next.actorUserId;
  return next;
}
