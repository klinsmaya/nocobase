/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { defineCollection } from '@nocobase/database';
import { generateNTemplate } from '../../locale';

function text(name: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    type: 'string',
    interface: 'input',
    uiSchema: {
      type: 'string',
      title: generateNTemplate(title),
      'x-component': 'Input',
      'x-read-pretty': true,
    },
    ...extra,
  };
}

function jsonField(name: string, title: string, allowNull = false) {
  return {
    name,
    type: 'json',
    allowNull,
    interface: 'json',
    uiSchema: {
      type: 'array',
      title: generateNTemplate(title),
      'x-component': 'Input.JSON',
      'x-read-pretty': true,
    },
  };
}

export default defineCollection({
  name: 'marketPlans',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Plans'),
  indexes: [{ unique: true, fields: ['ncTenantId', 'planId'] }],
  fields: [
    { name: 'id', type: 'bigInt', autoIncrement: true, primaryKey: true, allowNull: false, interface: 'id' },
    text('ncTenantId', 'Tenant', { allowNull: false }),
    text('planId', 'Plan ID', { allowNull: false }),
    text('state', 'State', { allowNull: false }),
    {
      type: 'belongsTo',
      name: 'release',
      target: 'marketReleases',
      foreignKey: 'releaseRowId',
      interface: 'm2o',
      uiSchema: { type: 'object', title: generateNTemplate('Release'), 'x-component': 'AssociationField' },
    },
    text('releaseId', 'Release ID', { allowNull: false }),
    text('releaseDigest', 'Release digest', { allowNull: false }),
    text('releaseVersion', 'Version', { allowNull: false }),
    {
      name: 'mappingRowId',
      type: 'bigInt',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Mapping'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    text('mappingId', 'Mapping ID', { allowNull: false }),
    {
      name: 'mappingRevision',
      type: 'integer',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Mapping revision'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    {
      name: 'policyRowId',
      type: 'bigInt',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Policy'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    text('policyId', 'Policy ID', { allowNull: false }),
    {
      name: 'policyVersion',
      type: 'integer',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Policy version'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    text('permissionDigest', 'Permission digest', { allowNull: false }),
    text('consumerType', 'Consumer type', { allowNull: false }),
    text('consumerId', 'Consumer ID', { allowNull: false }),
    text('consumerTenantId', 'Consumer tenant', { allowNull: false }),
    text('consumerSubjectId', 'Consumer subject', { allowNull: false }),
    text('targetScopeKind', 'Target scope kind', { allowNull: false }),
    text('targetScopeId', 'Target scope ID', { allowNull: false }),
    text('expiry', 'Expiry', { allowNull: false }),
    text('feeMode', 'Fee mode', { allowNull: false }),
    jsonField('dependencyLock', 'Dependency lock'),
    jsonField('credentialRefs', 'Credential refs'),
    jsonField('permissions', 'Permissions'),
    jsonField('destinations', 'Destinations'),
    jsonField('expectedChanges', 'Expected changes'),
    text('adapterVersion', 'Adapter version'),
    text('runtimeCapabilitiesDigest', 'Runtime capabilities digest'),
    text('preflightId', 'Preflight ID'),
    text('preflightDigest', 'Preflight digest'),
    text('preflightExpiry', 'Preflight expiry'),
    jsonField('steps', 'Steps', true),
    text('planHash', 'Plan hash'),
  ],
});
