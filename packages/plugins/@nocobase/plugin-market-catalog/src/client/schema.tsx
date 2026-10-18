/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { ISchema, useForm } from '@formily/react';
import { NocoBaseRecursionField, useActionContext, useBlockRequestContext, useRecord } from '@nocobase/client';
import React from 'react';
import { generateNTemplate } from '../locale';

type RecordValues = Record<string, unknown>;
type ActionName = 'create' | 'update' | 'transferOwnership' | 'revise' | 'eligibility';

function column(name: string, title: string): ISchema {
  return {
    type: 'void',
    'x-decorator': 'TableV2.Column.Decorator',
    'x-component': 'TableV2.Column',
    title: generateNTemplate(title),
    properties: {
      [name]: {
        type: 'string',
        'x-component': 'CollectionField',
        'x-read-pretty': true,
      },
    },
  };
}

function formField(name: string, title: string, component = 'Input'): ISchema {
  return {
    type: 'string',
    title: generateNTemplate(title),
    'x-decorator': 'FormItem',
    'x-component': component,
    'x-component-props': { 'aria-label': title },
  };
}

function useResourceAction(actionName: ActionName, revisionField: string | false) {
  const form = useForm();
  const record = useRecord() as RecordValues;
  const { resource, service } = useBlockRequestContext();
  const { setVisible } = useActionContext();
  return {
    async run() {
      await form.submit();
      const values: RecordValues = { ...(form.values as RecordValues) };
      if (revisionField) {
        values.expectedRevision = record[revisionField];
      }
      await resource[actionName]({
        filterByTk: record?.id,
        values,
      });
      setVisible(false);
      service?.refresh();
    },
  };
}

function useEligibility() {
  const record = useRecord() as RecordValues;
  const { resource, service } = useBlockRequestContext();
  return {
    async run() {
      try {
        await resource.eligibility({ filterByTk: record?.id });
      } finally {
        service?.refresh();
      }
    },
  };
}

const useCreate = () => useResourceAction('create', false);
const useSaveDraft = () => useResourceAction('update', 'revision');
const useTransfer = () => useResourceAction('transferOwnership', false);
const useRevise = () => useResourceAction('revise', 'revision');
const useRevisePolicy = () => useResourceAction('revise', 'policyVersion');

function footer(title: string, useAction: () => { run: () => Promise<void> }): ISchema {
  return {
    type: 'void',
    'x-component': 'Action.Modal.Footer',
    properties: {
      cancel: {
        title: '{{t("Cancel")}}',
        'x-component': 'Action',
        'x-component-props': { useAction: '{{ cm.useCancelAction }}' },
      },
      submit: {
        title: generateNTemplate(title),
        'x-component': 'Action',
        'x-component-props': { type: 'primary', useAction },
      },
    },
  };
}

function drawer(
  title: string,
  fields: Array<[string, string, string?]>,
  useAction: () => { run: () => Promise<void> },
): ISchema {
  const properties: Record<string, ISchema> = {};
  for (const [name, label, component] of fields) {
    properties[name] = formField(name, label, component);
  }
  properties.footer = footer(title, useAction);
  return {
    type: 'void',
    title: generateNTemplate(title),
    'x-decorator': 'Form',
    'x-component': 'Action.Modal',
    properties,
  };
}

function page(options: {
  resource: string;
  columns: Array<[string, string]>;
  create?: { title: string; fields: Array<[string, string, string?]> };
  row?: {
    title: string;
    action: ActionName;
    fields: Array<[string, string, string?]>;
    revision: boolean;
    policy?: boolean;
  };
  check?: boolean;
}): ISchema {
  const columns: Record<string, ISchema> = {};
  for (const [name, title] of options.columns) {
    columns[name] = column(name, title);
  }
  if (options.check) {
    columns.eligibility = {
      type: 'void',
      title: '{{ t("Actions") }}',
      'x-decorator': 'TableV2.Column.ActionBar',
      'x-component': 'TableV2.Column',
      properties: {
        check: {
          type: 'void',
          title: generateNTemplate('Check eligibility'),
          'x-component': 'Action',
          'x-component-props': { type: 'link', useAction: useEligibility },
        },
      },
    };
  }
  if (options.row) {
    const useAction = options.row.policy
      ? useRevisePolicy
      : options.row.revision
        ? options.row.action === 'update'
          ? useSaveDraft
          : useRevise
        : useTransfer;
    columns.rowAction = {
      type: 'void',
      title: '{{ t("Actions") }}',
      'x-decorator': 'TableV2.Column.ActionBar',
      'x-component': 'TableV2.Column',
      properties: {
        open: {
          type: 'void',
          title: generateNTemplate(options.row.title),
          'x-component': 'Action.Link',
          'x-component-props': { openMode: 'drawer' },
          properties: {
            modal: drawer(options.row.title, options.row.fields, useAction),
          },
        },
      },
    };
  }
  const toolbar: ISchema = options.create
    ? {
        type: 'void',
        'x-component': 'ActionBar',
        'x-component-props': { style: { marginBottom: 'var(--nb-spacing)' } },
        properties: {
          create: {
            type: 'void',
            title: generateNTemplate(options.create.title),
            'x-component': 'Action',
            'x-component-props': { type: 'primary', openMode: 'drawer', icon: 'PlusOutlined' },
            properties: {
              modal: drawer(options.create.title, options.create.fields, useCreate),
            },
          },
        },
      }
    : { type: 'void' };
  return {
    type: 'object',
    properties: {
      block: {
        type: 'void',
        'x-decorator': 'TableBlockProvider',
        'x-decorator-props': {
          collection: options.resource,
          resource: options.resource,
          action: 'list',
          params: { pageSize: 20, sort: ['-createdAt'] },
          rowKey: 'id',
        },
        'x-component': 'CardItem',
        properties: {
          toolbar,
          table: {
            type: 'array',
            'x-component': 'TableV2',
            'x-use-component-props': 'useTableBlockProps',
            'x-component-props': { rowKey: 'id' },
            properties: columns,
          },
        },
      },
    },
  };
}

export const publishersSchema = page({
  resource: 'marketPublishers',
  columns: [
    ['publisherSlug', 'Publisher slug'],
    ['displayName', 'Display name'],
    ['ownerUserId', 'Owner'],
    ['verificationStatus', 'Verification'],
  ],
  create: {
    title: 'Publishers',
    fields: [
      ['publisherSlug', 'Publisher slug'],
      ['displayName', 'Display name'],
    ],
  },
  row: {
    title: 'Transfer ownership',
    action: 'transferOwnership',
    revision: false,
    fields: [['toUserId', 'To user', 'InputNumber']],
  },
});

export const resourcesSchema = page({
  resource: 'marketResources',
  columns: [
    ['resourceId', 'Resource ID'],
    ['name', 'Resource name'],
    ['sourceKey', 'Source'],
    ['kind', 'Kind'],
    ['visibility', 'Visibility'],
  ],
  create: {
    title: 'Resources',
    fields: [
      ['publisherId', 'Publisher', 'InputNumber'],
      ['name', 'Resource name'],
      ['sourceKey', 'Source'],
      ['kind', 'Kind'],
      ['visibility', 'Visibility'],
    ],
  },
});

export const draftsSchema = page({
  resource: 'marketDrafts',
  columns: [
    ['resourceId', 'Resource ID'],
    ['title', 'Title'],
    ['revision', 'Revision'],
    ['etag', 'ETag'],
  ],
  create: {
    title: 'Drafts',
    fields: [
      ['resourceRowId', 'Resource', 'InputNumber'],
      ['title', 'Title'],
      ['summary', 'Summary'],
    ],
  },
  row: {
    title: 'Save draft',
    action: 'update',
    revision: true,
    fields: [
      ['title', 'Title'],
      ['summary', 'Summary'],
    ],
  },
});

export const mappingsSchema = page({
  resource: 'marketIdentityMappings',
  columns: [
    ['mappingId', 'Mapping ID'],
    ['revision', 'Revision'],
    ['invalidated', 'Invalidated'],
    ['ncSubjectId', 'Subject'],
    ['consumerId', 'Consumer ID'],
    ['expiry', 'Expiry'],
  ],
  create: {
    title: 'Identity mappings',
    fields: [
      ['mappingId', 'Mapping ID'],
      ['ncSubjectId', 'Subject'],
      ['consumerType', 'Consumer type'],
      ['consumerId', 'Consumer ID'],
      ['consumerTenantId', 'Consumer tenant'],
      ['consumerSubjectId', 'Consumer subject'],
      ['targetScopeKind', 'Target scope kind'],
      ['targetScopeId', 'Target scope ID'],
      ['allowedScope', 'Allowed scope', 'Input.JSON'],
      ['expiry', 'Expiry'],
      ['verification', 'Verification'],
    ],
  },
  row: {
    title: 'Revise mapping',
    action: 'revise',
    revision: true,
    fields: [['expiry', 'Expiry']],
  },
});

export const principalsSchema = page({
  resource: 'marketPrincipals',
  columns: [
    ['userId', 'User'],
    ['ncTenantId', 'Tenant'],
    ['ncSubjectId', 'Subject'],
  ],
  create: {
    title: 'Bind principal',
    fields: [
      ['userId', 'User', 'InputNumber'],
      ['ncSubjectId', 'Subject'],
    ],
  },
});

export const eventsSchema = page({
  resource: 'marketOwnershipEvents',
  columns: [
    ['publisherId', 'Publisher'],
    ['fromUserId', 'From user'],
    ['toUserId', 'To user'],
    ['actorUserId', 'Actor'],
  ],
});

export const releasesSchema = page({
  resource: 'marketReleases',
  columns: [
    ['releaseId', 'Release ID'],
    ['version', 'Version'],
    ['digest', 'Digest'],
    ['license', 'License'],
    ['state', 'State'],
    ['scanned', 'Scanned'],
    ['humanReviewed', 'Human reviewed'],
    ['publisherVerification', 'Publisher verification'],
  ],
});

export const scanReportsSchema = page({
  resource: 'marketScanReports',
  columns: [
    ['releaseId', 'Release ID'],
    ['passed', 'Scan passed'],
    ['digestOk', 'Digest ok'],
    ['secretsOk', 'Secrets ok'],
    ['scriptRisk', 'Script risk'],
    ['binaryRisk', 'Binary risk'],
  ],
});

export const reviewsSchema = page({
  resource: 'marketReviews',
  columns: [
    ['releaseId', 'Release ID'],
    ['decision', 'Decision'],
    ['publicMaterial', 'Public material'],
    ['reviewerUserId', 'Reviewer'],
  ],
});

export const sourcesSchema = page({
  resource: 'marketSources',
  columns: [
    ['sourceKey', 'Source'],
    ['adapterName', 'Adapter'],
    ['displayName', 'Display name'],
  ],
  create: {
    title: 'Sources',
    fields: [
      ['sourceKey', 'Source'],
      ['adapterName', 'Adapter'],
      ['displayName', 'Display name'],
    ],
  },
});

export const syncJobsSchema = page({
  resource: 'marketSyncJobs',
  columns: [
    ['sourceKey', 'Source'],
    ['kind', 'Job kind'],
    ['state', 'State'],
    ['nextCursor', 'Next cursor'],
    ['errorCategory', 'Error category'],
    ['errorCode', 'Error code'],
  ],
});

export const capabilitiesSchema = page({
  resource: 'marketCapabilityDeclarations',
  columns: [
    ['sourceKey', 'Source'],
    ['capability', 'Capability'],
    ['status', 'Status'],
  ],
});

export const auditEventsSchema = page({
  resource: 'marketAuditEvents',
  columns: [
    ['releaseId', 'Release ID'],
    ['action', 'Action'],
    ['reason', 'Reason'],
    ['actorUserId', 'Actor'],
  ],
});

export const policiesSchema = page({
  resource: 'marketPolicies',
  columns: [
    ['policyId', 'Policy ID'],
    ['policyVersion', 'Policy version'],
    ['active', 'Active'],
    ['permissionDigest', 'Permission digest'],
    ['feeMode', 'Fee mode'],
  ],
  create: {
    title: 'Policies',
    fields: [
      ['policyId', 'Policy ID'],
      ['allowedConsumerTypes', 'Allowed consumer types', 'Input.JSON'],
      ['permissions', 'Permissions', 'Input.JSON'],
      ['destinations', 'Destinations', 'Input.JSON'],
      ['feeMode', 'Fee mode'],
    ],
  },
  row: {
    title: 'Revise policy',
    action: 'revise',
    revision: true,
    policy: true,
    fields: [
      ['permissions', 'Permissions', 'Input.JSON'],
      ['destinations', 'Destinations', 'Input.JSON'],
      ['allowedConsumerTypes', 'Allowed consumer types', 'Input.JSON'],
      ['feeMode', 'Fee mode'],
    ],
  },
});

export const plansSchema = page({
  resource: 'marketPlans',
  columns: [
    ['planId', 'Plan ID'],
    ['state', 'State'],
    ['planHash', 'Plan hash'],
    ['releaseId', 'Release ID'],
    ['policyVersion', 'Policy version'],
    ['mappingRevision', 'Mapping revision'],
  ],
  check: true,
});

export const preflightsSchema = page({
  resource: 'marketPreflights',
  columns: [
    ['planId', 'Plan ID'],
    ['preflightId', 'Preflight ID'],
    ['status', 'Status'],
    ['source', 'Preflight source'],
    ['digest', 'Digest'],
  ],
});

export const approvalsSchema = page({
  resource: 'marketApprovals',
  columns: [
    ['planId', 'Plan ID'],
    ['planHash', 'Plan hash'],
    ['state', 'State'],
    ['invalidatedReason', 'Invalidated reason'],
    ['approverUserId', 'Approver'],
  ],
});

export function CatalogPage({ schema }: { schema: ISchema }) {
  return <NocoBaseRecursionField schema={schema} />;
}
