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
  name: 'marketDrafts',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Drafts'),
  indexes: [
    {
      unique: true,
      fields: ['ncTenantId', 'resourceRowId'],
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
      type: 'belongsTo',
      name: 'resource',
      target: 'marketResources',
      foreignKey: 'resourceRowId',
      interface: 'm2o',
      uiSchema: {
        type: 'object',
        title: generateNTemplate('Resource'),
        'x-component': 'AssociationField',
      },
    },
    {
      name: 'resourceId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Resource ID'),
        'x-component': 'Input',
        'x-read-pretty': true,
      },
    },
    {
      name: 'revision',
      type: 'integer',
      allowNull: false,
      defaultValue: 1,
      interface: 'integer',
      uiSchema: {
        type: 'number',
        title: generateNTemplate('Revision'),
        'x-component': 'InputNumber',
        'x-read-pretty': true,
      },
    },
    {
      name: 'etag',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('ETag'),
        'x-component': 'Input',
        'x-read-pretty': true,
      },
    },
    {
      name: 'title',
      type: 'string',
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Title'),
        'x-component': 'Input',
      },
    },
    {
      name: 'summary',
      type: 'text',
      interface: 'textarea',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Summary'),
        'x-component': 'Input.TextArea',
      },
    },
    {
      name: 'body',
      type: 'json',
      interface: 'json',
      uiSchema: {
        type: 'object',
        title: generateNTemplate('Body'),
        'x-component': 'Input.JSON',
      },
    },
  ],
});
