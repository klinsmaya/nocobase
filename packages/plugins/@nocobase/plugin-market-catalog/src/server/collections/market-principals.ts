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
  name: 'marketPrincipals',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Principals'),
  indexes: [
    {
      unique: true,
      fields: ['userId'],
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
      type: 'belongsTo',
      name: 'user',
      target: 'users',
      foreignKey: 'userId',
      targetKey: 'id',
      interface: 'm2o',
      uiSchema: {
        type: 'object',
        title: generateNTemplate('User'),
        'x-component': 'AssociationField',
        required: true,
      },
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
      name: 'ncSubjectId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Subject'),
        'x-component': 'Input',
        required: true,
      },
    },
  ],
});
