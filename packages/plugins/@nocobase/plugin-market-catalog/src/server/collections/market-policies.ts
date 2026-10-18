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

function jsonField(name: string, title: string) {
  return {
    name,
    type: 'json',
    allowNull: false,
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
  name: 'marketPolicies',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Policies'),
  indexes: [{ unique: true, fields: ['ncTenantId', 'policyId', 'policyVersion'] }],
  fields: [
    { name: 'id', type: 'bigInt', autoIncrement: true, primaryKey: true, allowNull: false, interface: 'id' },
    text('ncTenantId', 'Tenant', { allowNull: false }),
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
    {
      name: 'active',
      type: 'boolean',
      allowNull: false,
      interface: 'checkbox',
      uiSchema: {
        type: 'boolean',
        title: generateNTemplate('Active'),
        'x-component': 'Checkbox',
        'x-read-pretty': true,
      },
    },
    {
      name: 'requireVerifiedMapping',
      type: 'boolean',
      allowNull: false,
      interface: 'checkbox',
      uiSchema: {
        type: 'boolean',
        title: generateNTemplate('Require verified mapping'),
        'x-component': 'Checkbox',
        'x-read-pretty': true,
      },
    },
    jsonField('allowedConsumerTypes', 'Allowed consumer types'),
    jsonField('permissions', 'Permissions'),
    text('permissionDigest', 'Permission digest', { allowNull: false }),
    jsonField('destinations', 'Destinations'),
    text('feeMode', 'Fee mode', { allowNull: false }),
  ],
});
