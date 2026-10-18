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
  name: 'marketSources',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Sources'),
  indexes: [{ unique: true, fields: ['ncTenantId', 'sourceKey'] }],
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
      uiSchema: { type: 'string', title: generateNTemplate('Source'), 'x-component': 'Input', required: true },
    },
    {
      name: 'adapterName',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: { type: 'string', title: generateNTemplate('Adapter'), 'x-component': 'Input', required: true },
    },
    {
      name: 'displayName',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: { type: 'string', title: generateNTemplate('Display name'), 'x-component': 'Input', required: true },
    },
  ],
});
