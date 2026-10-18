/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { Context, Next } from '@nocobase/actions';
import { isMarketResource } from '../constants';
import { ShapeError } from './shape';

const STRIPPED_KEYS = [
  'actor',
  'actorUserId',
  'ownerUserId',
  'createdBy',
  'createdById',
  'updatedBy',
  'updatedById',
  'ncTenantId',
  'invalidated',
  'marketProtocolVersion',
  'schemaVersion',
  'state',
  'scanned',
  'scanPassed',
  'humanReviewed',
  'publisherVerification',
  'digest',
  'passed',
  'reviewerUserId',
  'secretFindings',
  'piiSignals',
];

export type Principal = {
  userId: number;
  ncTenantId: string;
  ncSubjectId: string;
};

type Row = {
  get(key: string): unknown;
};

export function fail(ctx: Context, status: number, message: string): never {
  const translate = (ctx as Context & { t?: (key: string) => string }).t;
  const text = typeof translate === 'function' ? translate(message) : message;
  throw ctx.throw(status, text);
}

export async function withShape(ctx: Context, next: Next, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ShapeError) {
      fail(ctx, 400, error.message);
    }
    throw error;
  }
}

export function principalFrom(ctx: Context): Principal {
  const principal = (ctx.state as { marketPrincipal?: Principal }).marketPrincipal;
  if (!principal) {
    fail(ctx, 403, 'Market principal is not bound');
  }
  return principal;
}

export async function bindTenant(ctx: Context, next: Next) {
  const resourceName = ctx.action?.resourceName;
  if (!resourceName || !isMarketResource(resourceName)) {
    await next();
    return;
  }
  const user = ctx.auth?.user as { id?: number } | undefined;
  if (!user?.id) {
    fail(ctx, 401, 'Unauthorized');
  }
  const row = (await ctx.db.getRepository('marketPrincipals').findOne({
    filter: { userId: user.id },
  })) as Row | null;
  if (!row) {
    fail(ctx, 403, 'Market principal is not bound');
  }
  const principal: Principal = {
    userId: user.id,
    ncTenantId: String(row.get('ncTenantId')),
    ncSubjectId: String(row.get('ncSubjectId')),
  };
  (ctx.state as { marketPrincipal?: Principal }).marketPrincipal = principal;
  const values = ctx.action.params.values;
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    const record = values as Record<string, unknown>;
    for (const key of STRIPPED_KEYS) {
      delete record[key];
    }
    record.ncTenantId = principal.ncTenantId;
  }
  ctx.action.mergeParams({
    filter: { ncTenantId: principal.ncTenantId },
  });
  await next();
}

export async function findInTenant(ctx: Context, collection: string, id: number) {
  const principal = principalFrom(ctx);
  const row = (await ctx.db.getRepository(collection).findOne({
    filterByTk: id,
    filter: { ncTenantId: principal.ncTenantId },
  })) as Row | null;
  return { principal, row };
}

export function isUniqueError(error: unknown) {
  return error instanceof Error && error.name === 'SequelizeUniqueConstraintError';
}
