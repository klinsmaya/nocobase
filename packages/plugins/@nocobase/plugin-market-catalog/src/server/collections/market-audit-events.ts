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
  name: 'marketAuditEvents',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: false,
  title: generateNTemplate('Audit events'),
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
      type: 'belongsTo',
      name: 'release',
      target: 'marketReleases',
      foreignKey: 'releaseRowId',
      interface: 'm2o',
      uiSchema: { type: 'object', title: generateNTemplate('Release'), 'x-component': 'AssociationField' },
    },
    {
      name: 'releaseId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Release ID'),
        'x-component': 'Input',
        'x-read-pretty': true,
      },
    },
    {
      name: 'action',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: { type: 'string', title: generateNTemplate('Action'), 'x-component': 'Input', 'x-read-pretty': true },
    },
    {
      name: 'reason',
      type: 'text',
      interface: 'textarea',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Reason'),
        'x-component': 'Input.TextArea',
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
