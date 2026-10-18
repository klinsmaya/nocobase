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
import { optionalText, readPositiveInt, readRecord } from './shape';
import { isAdapterName, readSourcePage } from './source-adapters';

type Row = {
  get(key: string): unknown;
};

export async function createSource(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const principal = principalFrom(ctx);
    const values = readRecord(ctx.action.params.values);
    const sourceKey = optionalText(values.sourceKey, 'sourceKey', 64);
    const displayName = optionalText(values.displayName, 'displayName', 200);
    const adapterName = typeof values.adapterName === 'string' ? values.adapterName : '';
    if (!sourceKey || !displayName || !isAdapterName(adapterName)) {
      fail(ctx, 400, 'Invalid source');
    }
    ctx.action.params.values = {
      ncTenantId: principal.ncTenantId,
      sourceKey,
      adapterName,
      displayName,
    };
    try {
      return await actions.create(ctx, next);
    } catch (error) {
      if (isUniqueError(error)) {
        fail(ctx, 409, 'Source already exists');
      }
      throw error;
    }
  });
}

export async function createSyncJob(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const principal = principalFrom(ctx);
    const values = readRecord(ctx.action.params.values);
    if (values.kind === 'agent') {
      fail(ctx, 400, 'Sync jobs do not run agents');
    }
    const kind = values.kind == null || values.kind === '' ? 'metadata-sync' : values.kind;
    if (kind !== 'metadata-sync') {
      fail(ctx, 400, 'Sync jobs do not run agents');
    }
    const sourceKey = optionalText(values.sourceKey, 'sourceKey', 64);
    if (!sourceKey) {
      fail(ctx, 400, 'Invalid source');
    }
    const source = (await ctx.db.getRepository('marketSources').findOne({
      filter: { ncTenantId: principal.ncTenantId, sourceKey },
    })) as Row | null;
    if (!source) {
      fail(ctx, 404, 'Source not found');
    }
    const pageSize = boundedInt(values.pageSize, 20, 1, 20);
    const itemLimit = boundedInt(values.itemLimit, 20, 1, 50);
    const timeoutMs = boundedInt(values.timeoutMs, 1000, 1, 5000);
    const stallMs = boundedInt(values.stallMs, 0, 0, 5000);
    if (pageSize == null || itemLimit == null || timeoutMs == null || stallMs == null) {
      fail(ctx, 400, 'Invalid sync limits');
    }
    const cursor = values.cursor == null || values.cursor === '' ? null : optionalText(values.cursor, 'cursor', 64);
    const failMode =
      values.failMode == null || values.failMode === '' ? null : optionalText(values.failMode, 'failMode', 64);
    if (failMode != null && failMode !== 'unavailable') {
      fail(ctx, 400, 'Invalid sync limits');
    }
    ctx.action.params.values = {
      ncTenantId: principal.ncTenantId,
      sourceKey,
      adapterName: String(source.get('adapterName')),
      kind: 'metadata-sync',
      state: 'queued',
      cursor,
      nextCursor: null,
      pageSize,
      itemLimit,
      timeoutMs,
      stallMs,
      failMode,
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      items: [],
    };
    return actions.create(ctx, next);
  });
}

export async function runSyncJob(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const id = readPositiveInt(ctx.action.params.filterByTk);
    if (!id) {
      fail(ctx, 400, 'Invalid sync job');
    }
    const { principal, row } = await findInTenant(ctx, 'marketSyncJobs', id);
    if (!row) {
      fail(ctx, 404, 'Sync job not found');
    }
    if (String(row.get('state')) !== 'queued') {
      fail(ctx, 409, 'Sync job is not queued');
    }
    if (String(row.get('kind')) !== 'metadata-sync') {
      fail(ctx, 400, 'Sync jobs do not run agents');
    }
    const [locked] = await ctx.db
      .getCollection('marketSyncJobs')
      .model.update({ state: 'running' }, { where: { id, ncTenantId: principal.ncTenantId, state: 'queued' } });
    if (locked !== 1) {
      fail(ctx, 409, 'Sync job is not queued');
    }
    const result = await readSourcePage({
      adapterName: String(row.get('adapterName')),
      cursor: row.get('cursor') == null ? null : String(row.get('cursor')),
      pageSize: Number(row.get('pageSize')),
      itemLimit: Number(row.get('itemLimit')),
      timeoutMs: Number(row.get('timeoutMs')),
      stallMs: Number(row.get('stallMs')),
      failMode: row.get('failMode') == null ? null : String(row.get('failMode')),
    });
    const patch = result.ok
      ? {
          state: 'succeeded',
          items: result.items,
          nextCursor: result.nextCursor,
          errorCategory: null,
          errorCode: null,
          errorMessage: null,
        }
      : {
          state: 'failed',
          items: [],
          nextCursor: null,
          errorCategory: result.category,
          errorCode: result.code,
          errorMessage: result.message,
        };
    await ctx.db.getCollection('marketSyncJobs').model.update(patch, {
      where: { id, ncTenantId: principal.ncTenantId, state: 'running' },
    });
    if (result.ok) {
      await saveCapabilities(ctx, principal.ncTenantId, String(row.get('sourceKey')), result.capabilities);
    }
    ctx.body = await ctx.db.getRepository('marketSyncJobs').findOne({ filterByTk: id });
    await next();
  });
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  if (value == null || value === '') {
    return fallback;
  }
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

async function saveCapabilities(
  ctx: Context,
  ncTenantId: string,
  sourceKey: string,
  capabilities: Array<{ capability: string; status: string }>,
) {
  for (const entry of capabilities) {
    const existing = (await ctx.db.getRepository('marketCapabilityDeclarations').findOne({
      filter: { ncTenantId, sourceKey, capability: entry.capability },
    })) as Row | null;
    if (!existing) {
      await ctx.db.getRepository('marketCapabilityDeclarations').create({
        values: { ncTenantId, sourceKey, capability: entry.capability, status: entry.status },
        context: ctx,
      });
      continue;
    }
    await ctx.db
      .getCollection('marketCapabilityDeclarations')
      .model.update({ status: entry.status }, { where: { id: existing.get('id'), ncTenantId } });
  }
}
