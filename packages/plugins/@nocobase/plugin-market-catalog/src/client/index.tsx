/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin } from '@nocobase/client';
import React from 'react';
import { NAMESPACE } from '../constants';
import {
  CatalogPage,
  auditEventsSchema,
  capabilitiesSchema,
  draftsSchema,
  eventsSchema,
  mappingsSchema,
  principalsSchema,
  publishersSchema,
  releasesSchema,
  resourcesSchema,
  reviewsSchema,
  scanReportsSchema,
  sourcesSchema,
  syncJobsSchema,
} from './schema';

function page(schema: Parameters<typeof CatalogPage>[0]['schema']) {
  return function MarketCatalogSettingsPage() {
    return <CatalogPage schema={schema} />;
  };
}

const PublishersPage = page(publishersSchema);
const ResourcesPage = page(resourcesSchema);
const DraftsPage = page(draftsSchema);
const MappingsPage = page(mappingsSchema);
const PrincipalsPage = page(principalsSchema);
const EventsPage = page(eventsSchema);

export class PluginMarketCatalogClient extends Plugin {
  async load() {
    this.app.pluginSettingsManager.add('market-catalog', {
      icon: 'ShopOutlined',
      title: `{{t("Market catalog", { ns: "${NAMESPACE}" })}}`,
      aclSnippet: 'pm.market-catalog',
    });
    this.app.pluginSettingsManager.add('market-catalog.publishers', {
      title: `{{t("Publishers", { ns: "${NAMESPACE}" })}}`,
      Component: PublishersPage,
      aclSnippet: 'pm.market-catalog',
      sort: 1,
    });
    this.app.pluginSettingsManager.add('market-catalog.resources', {
      title: `{{t("Resources", { ns: "${NAMESPACE}" })}}`,
      Component: ResourcesPage,
      aclSnippet: 'pm.market-catalog',
      sort: 2,
    });
    this.app.pluginSettingsManager.add('market-catalog.drafts', {
      title: `{{t("Drafts", { ns: "${NAMESPACE}" })}}`,
      Component: DraftsPage,
      aclSnippet: 'pm.market-catalog',
      sort: 3,
    });
    this.app.pluginSettingsManager.add('market-catalog.mappings', {
      title: `{{t("Identity mappings", { ns: "${NAMESPACE}" })}}`,
      Component: MappingsPage,
      aclSnippet: 'pm.market-catalog',
      sort: 4,
    });
    this.app.pluginSettingsManager.add('market-catalog.principals', {
      title: `{{t("Principals", { ns: "${NAMESPACE}" })}}`,
      Component: PrincipalsPage,
      aclSnippet: 'pm.market-catalog',
      sort: 5,
    });
    this.app.pluginSettingsManager.add('market-catalog.events', {
      title: `{{t("Ownership events", { ns: "${NAMESPACE}" })}}`,
      Component: EventsPage,
      aclSnippet: 'pm.market-catalog',
      sort: 6,
    });
    this.app.pluginSettingsManager.add('market-catalog.releases', {
      title: `{{t("Releases", { ns: "${NAMESPACE}" })}}`,
      Component: page(releasesSchema),
      aclSnippet: 'pm.market-catalog',
      sort: 7,
    });
    this.app.pluginSettingsManager.add('market-catalog.scans', {
      title: `{{t("Scan reports", { ns: "${NAMESPACE}" })}}`,
      Component: page(scanReportsSchema),
      aclSnippet: 'pm.market-catalog',
      sort: 8,
    });
    this.app.pluginSettingsManager.add('market-catalog.reviews', {
      title: `{{t("Reviews", { ns: "${NAMESPACE}" })}}`,
      Component: page(reviewsSchema),
      aclSnippet: 'pm.market-catalog',
      sort: 9,
    });
    this.app.pluginSettingsManager.add('market-catalog.audit', {
      title: `{{t("Audit events", { ns: "${NAMESPACE}" })}}`,
      Component: page(auditEventsSchema),
      aclSnippet: 'pm.market-catalog',
      sort: 10,
    });
    this.app.pluginSettingsManager.add('market-catalog.sources', {
      title: `{{t("Sources", { ns: "${NAMESPACE}" })}}`,
      Component: page(sourcesSchema),
      aclSnippet: 'pm.market-catalog',
      sort: 11,
    });
    this.app.pluginSettingsManager.add('market-catalog.sync-jobs', {
      title: `{{t("Sync jobs", { ns: "${NAMESPACE}" })}}`,
      Component: page(syncJobsSchema),
      aclSnippet: 'pm.market-catalog',
      sort: 12,
    });
    this.app.pluginSettingsManager.add('market-catalog.capabilities', {
      title: `{{t("Capability declarations", { ns: "${NAMESPACE}" })}}`,
      Component: page(capabilitiesSchema),
      aclSnippet: 'pm.market-catalog',
      sort: 13,
    });
  }
}

export default PluginMarketCatalogClient;
