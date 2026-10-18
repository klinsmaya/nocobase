/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export const NAMESPACE = '@nocobase/plugin-market-catalog';

export const MARKET_RESOURCES = [
  'marketPublishers',
  'marketResources',
  'marketDrafts',
  'marketIdentityMappings',
  'marketOwnershipEvents',
  'marketPrincipals',
  'marketReleases',
  'marketScanReports',
  'marketReviews',
  'marketAuditEvents',
  'marketSources',
  'marketSyncJobs',
  'marketCapabilityDeclarations',
] as const;

export type MarketResourceName = (typeof MARKET_RESOURCES)[number];

export function isMarketResource(name: string): name is MarketResourceName {
  return (MARKET_RESOURCES as readonly string[]).includes(name);
}
