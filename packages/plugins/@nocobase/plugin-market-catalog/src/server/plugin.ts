/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin } from '@nocobase/server';
import {
  createDraft,
  createMapping,
  createPrincipal,
  createPublisher,
  createResource,
  reviseMapping,
  transferOwnership,
  updateDraft,
  updatePublisher,
  updateResource,
} from './actions';
import { bindTenant } from './guard';

export class PluginMarketCatalogServer extends Plugin {
  async beforeLoad() {
    this.app.resourcer.define({
      name: 'marketPublishers',
      actions: {
        create: createPublisher,
        update: updatePublisher,
        transferOwnership,
      },
      only: ['list', 'get', 'create', 'update', 'transferOwnership'],
    });
    this.app.resourcer.define({
      name: 'marketResources',
      actions: {
        create: createResource,
        update: updateResource,
      },
      only: ['list', 'get', 'create', 'update'],
    });
    this.app.resourcer.define({
      name: 'marketDrafts',
      actions: {
        create: createDraft,
        update: updateDraft,
      },
      only: ['list', 'get', 'create', 'update'],
    });
    this.app.resourcer.define({
      name: 'marketIdentityMappings',
      actions: {
        create: createMapping,
        revise: reviseMapping,
      },
      only: ['list', 'get', 'create', 'revise'],
    });
    this.app.resourcer.define({
      name: 'marketPrincipals',
      actions: {
        create: createPrincipal,
      },
      only: ['list', 'get', 'create'],
    });
    this.app.resourcer.define({
      name: 'marketOwnershipEvents',
      only: ['list', 'get'],
    });
    this.app.acl.registerSnippet({
      name: 'pm.market-catalog',
      actions: [
        'marketPublishers:*',
        'marketResources:*',
        'marketDrafts:*',
        'marketIdentityMappings:*',
        'marketPrincipals:*',
        'marketOwnershipEvents:*',
      ],
    });
  }

  async load() {
    this.app.resourcer.use(bindTenant, {
      group: 'marketCatalog',
      before: 'acl',
      after: 'auth',
    });
  }
}

export default PluginMarketCatalogServer;
