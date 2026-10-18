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

export default defineCollection({
  name: 'marketApprovals',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Approvals'),
  indexes: [{ unique: true, fields: ['ncTenantId', 'approvalId'] }],
  fields: [
    { name: 'id', type: 'bigInt', autoIncrement: true, primaryKey: true, allowNull: false, interface: 'id' },
    text('ncTenantId', 'Tenant', { allowNull: false }),
    {
      type: 'belongsTo',
      name: 'plan',
      target: 'marketPlans',
      foreignKey: 'planRowId',
      interface: 'm2o',
      uiSchema: { type: 'object', title: generateNTemplate('Plan'), 'x-component': 'AssociationField' },
    },
    text('planId', 'Plan ID', { allowNull: false }),
    text('planHash', 'Plan hash', { allowNull: false }),
    text('approvalId', 'Approval ID', { allowNull: false }),
    text('state', 'State', { allowNull: false }),
    text('invalidatedReason', 'Invalidated reason'),
    {
      name: 'releaseRowId',
      type: 'bigInt',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Release'),
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
    text('preflightDigest', 'Preflight digest', { allowNull: false }),
    text('releaseDigest', 'Release digest', { allowNull: false }),
    {
      name: 'approverUserId',
      type: 'bigInt',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Approver'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    text('expiry', 'Expiry', { allowNull: false }),
  ],
});
