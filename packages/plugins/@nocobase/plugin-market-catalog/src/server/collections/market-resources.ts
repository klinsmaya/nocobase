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
  name: 'marketResources',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Resources'),
  indexes: [
    {
      unique: true,
      fields: ['ncTenantId', 'publisherId', 'name', 'sourceKey'],
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
      name: 'publisher',
      target: 'marketPublishers',
      foreignKey: 'publisherId',
      interface: 'm2o',
      uiSchema: {
        type: 'object',
        title: generateNTemplate('Publisher'),
        'x-component': 'AssociationField',
      },
    },
    {
      name: 'name',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Resource name'),
        'x-component': 'Input',
        required: true,
      },
    },
    {
      name: 'sourceKey',
      type: 'string',
      allowNull: false,
      defaultValue: 'local',
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Source'),
        'x-component': 'Input',
        required: true,
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
      name: 'kind',
      type: 'string',
      allowNull: false,
      interface: 'select',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Kind'),
        'x-component': 'Select',
        required: true,
        enum: [
          { label: 'skill', value: 'skill' },
          { label: 'agent', value: 'agent' },
          { label: 'mcp', value: 'mcp' },
          { label: 'squad', value: 'squad' },
          { label: 'knowledge', value: 'knowledge' },
          { label: 'runtime_plugin', value: 'runtime_plugin' },
        ],
      },
    },
    {
      name: 'visibility',
      type: 'string',
      allowNull: false,
      defaultValue: 'private',
      interface: 'select',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Visibility'),
        'x-component': 'Select',
        enum: [
          { label: 'private', value: 'private' },
          { label: 'workspace', value: 'workspace' },
          { label: 'organization', value: 'organization' },
          { label: 'public', value: 'public' },
        ],
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
  ],
});
