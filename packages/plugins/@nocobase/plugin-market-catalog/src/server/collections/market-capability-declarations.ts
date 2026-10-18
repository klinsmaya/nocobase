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

export default defineCollection({
  name: 'marketCapabilityDeclarations',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Capability declarations'),
  indexes: [{ unique: true, fields: ['ncTenantId', 'sourceKey', 'capability'] }],
  fields: [
    { name: 'id', type: 'bigInt', autoIncrement: true, primaryKey: true, allowNull: false, interface: 'id' },
    {
      name: 'ncTenantId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: { type: 'string', title: generateNTemplate('Tenant'), 'x-component': 'Input', 'x-read-pretty': true },
    },
    {
      name: 'sourceKey',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: { type: 'string', title: generateNTemplate('Source'), 'x-component': 'Input', 'x-read-pretty': true },
    },
    {
      name: 'capability',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Capability'),
        'x-component': 'Input',
        'x-read-pretty': true,
      },
    },
    {
      name: 'status',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: { type: 'string', title: generateNTemplate('Status'), 'x-component': 'Input', 'x-read-pretty': true },
    },
  ],
});
