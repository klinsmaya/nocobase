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

function text(name: string, title: string) {
  return {
    name,
    type: 'string',
    interface: 'input',
    uiSchema: { type: 'string', title: generateNTemplate(title), 'x-component': 'Input', 'x-read-pretty': true },
  };
}

export default defineCollection({
  name: 'marketSyncJobs',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Sync jobs'),
  fields: [
    { name: 'id', type: 'bigInt', autoIncrement: true, primaryKey: true, allowNull: false, interface: 'id' },
    text('ncTenantId', 'Tenant'),
    text('sourceKey', 'Source'),
    text('adapterName', 'Adapter'),
    text('kind', 'Job kind'),
    text('state', 'State'),
    text('cursor', 'Cursor'),
    text('nextCursor', 'Next cursor'),
    text('failMode', 'Failure mode'),
    text('errorCategory', 'Error category'),
    text('errorCode', 'Error code'),
    text('errorMessage', 'Error message'),
    {
      name: 'pageSize',
      type: 'integer',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Page size'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    {
      name: 'itemLimit',
      type: 'integer',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Item limit'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    {
      name: 'timeoutMs',
      type: 'integer',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Timeout'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    {
      name: 'stallMs',
      type: 'integer',
      allowNull: false,
      defaultValue: 0,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Stall'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    {
      name: 'items',
      type: 'json',
      interface: 'json',
      uiSchema: {
        type: 'array',
        title: generateNTemplate('Items'),
        'x-component': 'Input.JSON',
        'x-read-pretty': true,
      },
    },
  ],
});
