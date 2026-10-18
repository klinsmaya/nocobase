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

function flag(name: string, title: string) {
  return {
    name,
    type: 'boolean',
    allowNull: false,
    interface: 'checkbox',
    uiSchema: { type: 'boolean', title: generateNTemplate(title), 'x-component': 'Checkbox', 'x-read-pretty': true },
  };
}

export default defineCollection({
  name: 'marketScanReports',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: false,
  title: generateNTemplate('Scan reports'),
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
    flag('passed', 'Scan passed'),
    flag('digestOk', 'Digest ok'),
    flag('structureOk', 'Structure ok'),
    flag('pathOk', 'Path ok'),
    flag('sizeOk', 'Size ok'),
    flag('licenseOk', 'License ok'),
    flag('sourceOk', 'Source ok'),
    flag('secretsOk', 'Secrets ok'),
    flag('scriptRisk', 'Script risk'),
    flag('binaryRisk', 'Binary risk'),
    {
      name: 'secretFindings',
      type: 'json',
      allowNull: false,
      interface: 'json',
      uiSchema: {
        type: 'array',
        title: generateNTemplate('Secret findings'),
        'x-component': 'Input.JSON',
        'x-read-pretty': true,
      },
    },
    {
      name: 'piiSignals',
      type: 'json',
      allowNull: false,
      interface: 'json',
      uiSchema: {
        type: 'array',
        title: generateNTemplate('PII signals'),
        'x-component': 'Input.JSON',
        'x-read-pretty': true,
      },
    },
  ],
});
