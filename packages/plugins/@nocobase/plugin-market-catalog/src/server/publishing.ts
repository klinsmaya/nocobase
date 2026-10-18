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
import { isReleaseId, PUBLIC_MATERIALS, scanPackage, type PublicMaterial, type ScanResult } from './package-scan';
import { optionalText, parseEnum, readPositiveInt, readRecord, VISIBILITIES, type Visibility } from './shape';

type Row = {
  get(key: string): unknown;
  toJSON(): Record<string, unknown>;
};

export async function createRelease(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const principal = principalFrom(ctx);
    const values = readRecord(ctx.action.params.values);
    const resourceRowId = readPositiveInt(values.resourceRowId);
    const releaseId = typeof values.releaseId === 'string' ? values.releaseId : '';
    if (!resourceRowId || !isReleaseId(releaseId)) {
      fail(ctx, 400, 'Invalid release');
    }
    const resource = await findResource(ctx, principal.ncTenantId, resourceRowId);
    const sourceKey =
      values.sourceKey == null || values.sourceKey === ''
        ? String(resource.get('sourceKey'))
        : optionalText(values.sourceKey, 'sourceKey', 64);
    if (!sourceKey || sourceKey !== String(resource.get('sourceKey'))) {
      fail(ctx, 400, 'Source does not match the resource');
    }
    const visibility = readVisibility(values.visibility, String(resource.get('visibility')));
    const declaredDigest =
      values.declaredDigest == null || values.declaredDigest === ''
        ? undefined
        : optionalText(values.declaredDigest, 'declaredDigest', 80);
    const scanned = scanPackage({
      manifest: values.manifest,
      files: values.files,
      sourceKey,
      resourceName: String(resource.get('name')),
      declaredDigest: declaredDigest ?? undefined,
    });
    if (!scanned.digestOk) {
      fail(ctx, 400, 'Digest mismatch');
    }
    if (!scanned.pathOk) {
      fail(ctx, 400, 'Unsafe package path');
    }
    if (!scanned.sizeOk) {
      fail(ctx, 400, 'Package exceeds size limit');
    }
    if (!scanned.version || !scanned.license) {
      fail(ctx, 400, 'Invalid package manifest');
    }
    const publisher = (await ctx.db.getRepository('marketPublishers').findOne({
      filterByTk: resource.get('publisherId'),
      filter: { ncTenantId: principal.ncTenantId },
    })) as Row | null;
    ctx.action.params.values = {
      ncTenantId: principal.ncTenantId,
      resourceRowId,
      resourceId: String(resource.get('resourceId')),
      releaseId,
      version: scanned.version,
      digest: scanned.digest,
      manifestRef: `manifest:${releaseId}`,
      license: scanned.license,
      sourceKey,
      visibility,
      state: 'draft',
      scanned: false,
      scanPassed: false,
      humanReviewed: false,
      publisherVerification: publisher ? String(publisher.get('verificationStatus')) : 'unverified',
      manifest: values.manifest,
      files: values.files,
    };
    try {
      return await actions.create(ctx, next);
    } catch (error) {
      if (isUniqueError(error)) {
        fail(ctx, 409, 'Release already exists');
      }
      throw error;
    }
  });
}

export async function scanRelease(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const { principal, row } = await loadRelease(ctx);
    const scanned = scanStored(row);
    const report = await ctx.db.getRepository('marketScanReports').create({
      values: {
        ncTenantId: principal.ncTenantId,
        releaseRowId: row.get('id'),
        releaseId: String(row.get('releaseId')),
        passed: scanned.passed,
        digestOk: scanned.digestOk,
        structureOk: scanned.structureOk,
        pathOk: scanned.pathOk,
        sizeOk: scanned.sizeOk,
        licenseOk: scanned.licenseOk,
        sourceOk: scanned.sourceOk,
        secretsOk: scanned.secretsOk,
        scriptRisk: scanned.scriptRisk,
        binaryRisk: scanned.binaryRisk,
        secretFindings: scanned.secretFindings,
        piiSignals: scanned.piiSignals,
      },
      context: ctx,
    });
    await ctx.db
      .getCollection('marketReleases')
      .model.update(
        { scanned: true, scanPassed: scanned.passed },
        { where: { id: row.get('id'), ncTenantId: principal.ncTenantId } },
      );
    await writeAudit(
      ctx,
      principal.ncTenantId,
      row,
      'scan',
      scanned.passed ? 'automated scan passed' : 'automated scan failed',
    );
    ctx.body = report;
    await next();
  });
}

export async function reviewRelease(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const { principal, row } = await loadRelease(ctx);
    if (String(row.get('state')) !== 'draft') {
      fail(ctx, 409, 'Release content is immutable');
    }
    const values = readRecord(ctx.action.params.values);
    const decision = values.decision === 'approved' || values.decision === 'rejected' ? values.decision : '';
    const publicMaterial = typeof values.publicMaterial === 'string' ? values.publicMaterial : '';
    if (!decision || !['unspecified', ...PUBLIC_MATERIALS].includes(publicMaterial)) {
      fail(ctx, 400, 'Invalid review');
    }
    const review = await ctx.db.getRepository('marketReviews').create({
      values: {
        ncTenantId: principal.ncTenantId,
        releaseRowId: row.get('id'),
        releaseId: String(row.get('releaseId')),
        decision,
        publicMaterial,
        reviewerUserId: principal.userId,
      },
      context: ctx,
    });
    await ctx.db
      .getCollection('marketReleases')
      .model.update(
        { humanReviewed: true, publicMaterial },
        { where: { id: row.get('id'), ncTenantId: principal.ncTenantId, state: 'draft' } },
      );
    await writeAudit(ctx, principal.ncTenantId, row, 'review', decision);
    ctx.body = review;
    await next();
  });
}

export async function publishRelease(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const { principal, row } = await loadRelease(ctx);
    if (String(row.get('state')) !== 'draft') {
      fail(ctx, 409, 'Release content is immutable');
    }
    const scanned = scanStored(row);
    if (!scanned.digestOk || scanned.digest !== String(row.get('digest'))) {
      fail(ctx, 409, 'Digest mismatch');
    }
    if (!row.get('scanned') || !row.get('scanPassed') || !scanned.passed) {
      fail(ctx, 409, 'Automated scan has not passed');
    }
    const review = await latestReview(ctx, principal.ncTenantId, Number(row.get('id')));
    if (!review || String(review.get('decision')) !== 'approved') {
      fail(ctx, 409, 'Human review is required');
    }
    const material = String(review.get('publicMaterial'));
    if (String(row.get('visibility')) === 'public' && !PUBLIC_MATERIALS.includes(material as PublicMaterial)) {
      fail(ctx, 409, 'Public material review is required');
    }
    const publisher = await publisherStatus(ctx, principal.ncTenantId, Number(row.get('resourceRowId')));
    const [affected] = await ctx.db.getCollection('marketReleases').model.update(
      {
        state: 'published',
        publisherVerification: publisher,
        publicMaterial: material,
      },
      { where: { id: row.get('id'), ncTenantId: principal.ncTenantId, state: 'draft', digest: row.get('digest') } },
    );
    if (affected !== 1) {
      fail(ctx, 409, 'Release content is immutable');
    }
    await writeAudit(ctx, principal.ncTenantId, row, 'publish', null);
    ctx.body = await ctx.db.getRepository('marketReleases').findOne({ filterByTk: row.get('id') });
    await next();
  });
}

export async function replaceRelease(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    await loadRelease(ctx);
    fail(ctx, 409, 'Release content is immutable');
  });
}

export async function revokeRelease(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const { principal, row } = await loadRelease(ctx);
    const reason = optionalText(readRecord(ctx.action.params.values).reason, 'reason', 400);
    if (!reason) {
      fail(ctx, 400, 'Revoke reason is required');
    }
    if (String(row.get('state')) !== 'published') {
      fail(ctx, 409, 'Only a published release can be revoked');
    }
    const [affected] = await ctx.db.getCollection('marketReleases').model.update(
      { state: 'revoked', revokeReason: reason },
      {
        where: { id: row.get('id'), ncTenantId: principal.ncTenantId, state: 'published', digest: row.get('digest') },
      },
    );
    if (affected !== 1) {
      fail(ctx, 409, 'Only a published release can be revoked');
    }
    await writeAudit(ctx, principal.ncTenantId, row, 'revoke', reason);
    ctx.body = await ctx.db.getRepository('marketReleases').findOne({ filterByTk: row.get('id') });
    await next();
  });
}

export async function distributeRelease(ctx: Context, next: Next) {
  return withShape(ctx, next, async () => {
    const { row } = await loadRelease(ctx);
    const state = String(row.get('state'));
    if (state === 'revoked') {
      fail(ctx, 403, 'Revoked release cannot be installed');
    }
    if (state !== 'published') {
      fail(ctx, 409, 'Release is not published');
    }
    ctx.body = {
      releaseId: row.get('releaseId'),
      digest: row.get('digest'),
      distribution: 'allowed',
    };
    await next();
  });
}

async function loadRelease(ctx: Context) {
  const id = readPositiveInt(ctx.action.params.filterByTk);
  if (!id) {
    fail(ctx, 400, 'Invalid release');
  }
  const { principal, row } = await findInTenant(ctx, 'marketReleases', id);
  if (!row) {
    fail(ctx, 404, 'Release not found');
  }
  return { principal, row };
}

async function findResource(ctx: Context, ncTenantId: string, id: number) {
  const resource = (await ctx.db.getRepository('marketResources').findOne({
    filterByTk: id,
    filter: { ncTenantId },
  })) as Row | null;
  if (!resource) {
    fail(ctx, 404, 'Resource not found');
  }
  return resource;
}

function readVisibility(value: unknown, fallback: string): Visibility {
  if (value == null || value === '') {
    return parseEnum(fallback, VISIBILITIES, 'visibility');
  }
  return parseEnum(value, VISIBILITIES, 'visibility');
}

function scanStored(row: Row): ScanResult {
  return scanPackage({
    manifest: row.get('manifest'),
    files: row.get('files'),
    sourceKey: String(row.get('sourceKey')),
    resourceName: String(row.get('resourceId')).split('/')[1] || '',
    declaredDigest: String(row.get('digest')),
  });
}

async function latestReview(ctx: Context, ncTenantId: string, releaseRowId: number) {
  const rows = (await ctx.db.getRepository('marketReviews').find({
    filter: { ncTenantId, releaseRowId },
    sort: ['-id'],
    limit: 1,
  })) as Row[];
  return rows[0] ?? null;
}

async function publisherStatus(ctx: Context, ncTenantId: string, resourceRowId: number) {
  const resource = (await ctx.db.getRepository('marketResources').findOne({
    filterByTk: resourceRowId,
    filter: { ncTenantId },
  })) as Row | null;
  if (!resource) {
    return 'unverified';
  }
  const publisher = (await ctx.db.getRepository('marketPublishers').findOne({
    filterByTk: resource.get('publisherId'),
    filter: { ncTenantId },
  })) as Row | null;
  return publisher ? String(publisher.get('verificationStatus')) : 'unverified';
}

async function writeAudit(ctx: Context, ncTenantId: string, row: Row, action: string, reason: string | null) {
  await ctx.db.getRepository('marketAuditEvents').create({
    values: {
      ncTenantId,
      releaseRowId: row.get('id'),
      releaseId: String(row.get('releaseId')),
      action,
      reason,
      actorUserId: principalFrom(ctx).userId,
    },
    context: ctx,
  });
}
