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
  name: 'marketOwnershipEvents',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: false,
  title: generateNTemplate('Ownership events'),
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
      type: 'belongsTo',
      name: 'publisher',
      target: 'marketPublishers',
      foreignKey: 'publisherId',
      interface: 'm2o',
      uiSchema: {
        type: 'object',
        title: generateNTemplate('Publisher'),
        'x-component': 'AssociationField',
        'x-read-pretty': true,
      },
    },
    {
      name: 'fromUserId',
      type: 'bigInt',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('From user'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    {
      name: 'toUserId',
      type: 'bigInt',
      allowNull: false,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('To user'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    {
      name: 'actorUserId',
      type: 'context',
      dataType: 'bigInt',
      dataIndex: 'state.currentUser.id',
      createOnly: true,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Actor'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
  ],
});
