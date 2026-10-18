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
  name: 'marketPublishers',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Publishers'),
  indexes: [
    {
      unique: true,
      fields: ['ncTenantId', 'publisherSlug'],
    },
  ],
  fields: [
    {
      name: 'id',
      type: 'bigInt',
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      interface: 'id',
    },
    {
      name: 'ncTenantId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Tenant'),
        'x-component': 'Input',
        'x-read-pretty': true,
      },
    },
    {
      name: 'publisherSlug',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Publisher slug'),
        'x-component': 'Input',
        required: true,
      },
    },
    {
      name: 'displayName',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Display name'),
        'x-component': 'Input',
        required: true,
      },
    },
    {
      name: 'ownerUserId',
      type: 'context',
      dataType: 'bigInt',
      dataIndex: 'state.currentUser.id',
      createOnly: true,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Owner'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    {
      name: 'verificationStatus',
      type: 'string',
      allowNull: false,
      defaultValue: 'unverified',
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Verification'),
        'x-component': 'Input',
        'x-read-pretty': true,
      },
    },
  ],
});
