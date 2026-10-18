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
  name: 'marketIdentityMappings',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Identity mappings'),
  indexes: [
    {
      unique: true,
      fields: ['ncTenantId', 'mappingId', 'revision'],
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
      name: 'marketProtocolVersion',
      type: 'string',
      allowNull: false,
      defaultValue: 'draft-1',
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Protocol version'),
        'x-component': 'Input',
        'x-read-pretty': true,
      },
    },
    {
      name: 'schemaVersion',
      type: 'string',
      allowNull: false,
      defaultValue: 'draft-1',
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Schema version'),
        'x-component': 'Input',
        'x-read-pretty': true,
      },
    },
    {
      name: 'mappingId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Mapping ID'),
        'x-component': 'Input',
        required: true,
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
      name: 'invalidated',
      type: 'boolean',
      allowNull: false,
      defaultValue: false,
      interface: 'checkbox',
      uiSchema: {
        type: 'boolean',
        title: generateNTemplate('Invalidated'),
        'x-component': 'Checkbox',
        'x-read-pretty': true,
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
    {
      name: 'consumerType',
      type: 'string',
      allowNull: false,
      interface: 'select',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Consumer type'),
        'x-component': 'Select',
        required: true,
        enum: [
          { label: 'multica', value: 'multica' },
          { label: 'dsh', value: 'dsh' },
        ],
      },
    },
    {
      name: 'consumerId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Consumer ID'),
        'x-component': 'Input',
        required: true,
      },
    },
    {
      name: 'consumerTenantId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Consumer tenant'),
        'x-component': 'Input',
        required: true,
      },
    },
    {
      name: 'consumerSubjectId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Consumer subject'),
        'x-component': 'Input',
        required: true,
      },
    },
    {
      name: 'targetScopeKind',
      type: 'string',
      allowNull: false,
      interface: 'select',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Target scope kind'),
        'x-component': 'Select',
        required: true,
        enum: [
          { label: 'workspace', value: 'workspace' },
          { label: 'profile', value: 'profile' },
          { label: 'project', value: 'project' },
        ],
      },
    },
    {
      name: 'targetScopeId',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Target scope ID'),
        'x-component': 'Input',
        required: true,
      },
    },
    {
      name: 'allowedScope',
      type: 'json',
      allowNull: false,
      interface: 'json',
      uiSchema: {
        type: 'array',
        title: generateNTemplate('Allowed scope'),
        'x-component': 'Input.JSON',
        required: true,
      },
    },
    {
      name: 'expiry',
      type: 'string',
      allowNull: false,
      interface: 'input',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Expiry'),
        'x-component': 'Input',
        required: true,
      },
    },
    {
      name: 'verification',
      type: 'string',
      allowNull: false,
      interface: 'select',
      uiSchema: {
        type: 'string',
        title: generateNTemplate('Verification'),
        'x-component': 'Select',
        required: true,
        enum: [
          { label: 'verified', value: 'verified' },
          { label: 'unverified', value: 'unverified' },
          { label: 'rejected', value: 'rejected' },
        ],
      },
    },
  ],
});
