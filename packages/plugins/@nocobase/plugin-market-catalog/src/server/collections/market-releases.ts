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

function text(name: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    type: 'string',
    interface: 'input',
    uiSchema: {
      type: 'string',
      title: generateNTemplate(title),
      'x-component': 'Input',
      'x-read-pretty': true,
    },
    ...extra,
  };
}

export default defineCollection({
  name: 'marketReleases',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: true,
  title: generateNTemplate('Releases'),
  indexes: [{ unique: true, fields: ['ncTenantId', 'releaseId'] }],
  fields: [
    { name: 'id', type: 'bigInt', autoIncrement: true, primaryKey: true, allowNull: false, interface: 'id' },
    text('ncTenantId', 'Tenant', { allowNull: false }),
    {
      type: 'belongsTo',
      name: 'resource',
      target: 'marketResources',
      foreignKey: 'resourceRowId',
      interface: 'm2o',
      uiSchema: { type: 'object', title: generateNTemplate('Resource'), 'x-component': 'AssociationField' },
    },
    text('resourceId', 'Resource ID', { allowNull: false }),
    text('releaseId', 'Release ID', { allowNull: false }),
    text('version', 'Version', { allowNull: false }),
    text('digest', 'Digest', { allowNull: false }),
    text('manifestRef', 'Manifest ref', { allowNull: false }),
    text('license', 'License', { allowNull: false }),
    text('sourceKey', 'Source', { allowNull: false }),
    text('visibility', 'Visibility', { allowNull: false }),
    text('state', 'State', { allowNull: false, defaultValue: 'draft' }),
    {
      name: 'scanned',
      type: 'boolean',
      allowNull: false,
      defaultValue: false,
      interface: 'checkbox',
      uiSchema: {
        type: 'boolean',
        title: generateNTemplate('Scanned'),
        'x-component': 'Checkbox',
        'x-read-pretty': true,
      },
    },
    {
      name: 'scanPassed',
      type: 'boolean',
      allowNull: false,
      defaultValue: false,
      interface: 'checkbox',
      uiSchema: {
        type: 'boolean',
        title: generateNTemplate('Scan passed'),
        'x-component': 'Checkbox',
        'x-read-pretty': true,
      },
    },
    {
      name: 'humanReviewed',
      type: 'boolean',
      allowNull: false,
      defaultValue: false,
      interface: 'checkbox',
      uiSchema: {
        type: 'boolean',
        title: generateNTemplate('Human reviewed'),
        'x-component': 'Checkbox',
        'x-read-pretty': true,
      },
    },
    text('publisherVerification', 'Publisher verification', { allowNull: false, defaultValue: 'unverified' }),
    text('publicMaterial', 'Public material'),
    text('revokeReason', 'Revoke reason'),
    {
      name: 'manifest',
      type: 'json',
      allowNull: false,
      interface: 'json',
      uiSchema: {
        type: 'object',
        title: generateNTemplate('Manifest'),
        'x-component': 'Input.JSON',
        'x-read-pretty': true,
      },
    },
    {
      name: 'files',
      type: 'json',
      allowNull: false,
      interface: 'json',
      uiSchema: {
        type: 'array',
        title: generateNTemplate('Files'),
        'x-component': 'Input.JSON',
        'x-read-pretty': true,
      },
    },
  ],
});
