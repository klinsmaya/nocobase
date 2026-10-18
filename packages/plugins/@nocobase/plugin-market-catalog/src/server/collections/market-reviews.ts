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
  name: 'marketReviews',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: false,
  title: generateNTemplate('Reviews'),
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
      name: 'decision',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: { type: 'string', title: generateNTemplate('Decision'), 'x-component': 'Input', 'x-read-pretty': true },
    },
    {
      name: 'publicMaterial',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: { type: 'string', title: generateNTemplate('Public material'), 'x-component': 'Input' },
    },
    {
      name: 'reviewerUserId',
      type: 'context',
      dataType: 'bigInt',
      dataIndex: 'state.currentUser.id',
      createOnly: true,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Reviewer'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
  ],
});
