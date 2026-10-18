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
    allowNull: false,
    interface: 'input',
    uiSchema: {
      type: 'string',
      title: generateNTemplate(title),
      'x-component': 'Input',
      'x-read-pretty': true,
    },
  };
}

export default defineCollection({
  name: 'marketPreflights',
  origin: '@nocobase/plugin-market-catalog',
  dataCategory: 'business',
  dumpRules: 'required',
  migrationRules: ['schema-only'],
  createdBy: true,
  updatedBy: false,
  title: generateNTemplate('Preflights'),
  indexes: [{ unique: true, fields: ['ncTenantId', 'planRowId', 'preflightId'] }],
  fields: [
    { name: 'id', type: 'bigInt', autoIncrement: true, primaryKey: true, allowNull: false, interface: 'id' },
    text('ncTenantId', 'Tenant'),
    {
      type: 'belongsTo',
      name: 'plan',
      target: 'marketPlans',
      foreignKey: 'planRowId',
      interface: 'm2o',
      uiSchema: { type: 'object', title: generateNTemplate('Plan'), 'x-component': 'AssociationField' },
    },
    text('planId', 'Plan ID'),
    text('preflightId', 'Preflight ID'),
    text('digest', 'Digest'),
    text('status', 'Status'),
    text('source', 'Preflight source'),
    text('expiresAt', 'Preflight expiry'),
    {
      name: 'report',
      type: 'json',
      allowNull: false,
      interface: 'json',
      uiSchema: {
        type: 'object',
        title: generateNTemplate('Preflight report'),
        'x-component': 'Input.JSON',
        'x-read-pretty': true,
      },
    },
  ],
});
