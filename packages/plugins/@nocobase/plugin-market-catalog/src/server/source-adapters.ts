/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export const ADAPTER_NAMES = ['fixture-catalog', 'fixture-pages'] as const;
export type AdapterName = (typeof ADAPTER_NAMES)[number];

export type CapabilityStatus = 'supported' | 'unsupported' | 'unverified';

export type SourceItem = {
  sourceItemId: string;
  name: string;
  kind: string;
};

export type AdapterSuccess = {
  ok: true;
  items: SourceItem[];
  nextCursor: string | null;
  capabilities: Array<{ capability: string; status: CapabilityStatus }>;
};

export type AdapterFailure = {
  ok: false;
  category: 'source_unavailable' | 'unsupported' | 'timeout';
  code: string;
  message: string;
};

export type AdapterResult = AdapterSuccess | AdapterFailure;

const CATALOG_ITEMS: SourceItem[] = [
  { sourceItemId: 'cat-1', name: 'notes', kind: 'skill' },
  { sourceItemId: 'cat-2', name: 'checklist', kind: 'skill' },
  { sourceItemId: 'cat-3', name: 'brief', kind: 'knowledge' },
  { sourceItemId: 'cat-4', name: 'glossary', kind: 'knowledge' },
  { sourceItemId: 'cat-5', name: 'template', kind: 'skill' },
];

const PAGE_ITEMS: SourceItem[] = [
  { sourceItemId: 'page-1', name: 'host-notes', kind: 'skill' },
  { sourceItemId: 'page-2', name: 'host-agent', kind: 'agent' },
  { sourceItemId: 'page-3', name: 'host-squad', kind: 'squad' },
];

const CAPABILITIES: Record<AdapterName, AdapterSuccess['capabilities']> = {
  'fixture-catalog': [
    { capability: 'resource.skill.install', status: 'supported' },
    { capability: 'agent.instantiate', status: 'unverified' },
  ],
  'fixture-pages': [
    { capability: 'resource.skill.install', status: 'supported' },
    { capability: 'execution.multi_member', status: 'unsupported' },
  ],
};

export function isAdapterName(value: string): value is AdapterName {
  return (ADAPTER_NAMES as readonly string[]).includes(value);
}

export async function readSourcePage(input: {
  adapterName: string;
  cursor: string | null;
  pageSize: number;
  itemLimit: number;
  timeoutMs: number;
  stallMs: number;
  failMode: string | null;
}): Promise<AdapterResult> {
  if (!isAdapterName(input.adapterName)) {
    return {
      ok: false,
      category: 'unsupported',
      code: 'adapter.unsupported',
      message: `${input.adapterName} is not an allowed source adapter`,
    };
  }
  if (input.failMode === 'unavailable') {
    return {
      ok: false,
      category: 'source_unavailable',
      code: 'source.unavailable',
      message: 'The source did not respond',
    };
  }
  const started = Date.now();
  if (input.stallMs > 0) {
    await wait(Math.min(input.stallMs, input.timeoutMs + 20));
  }
  if (input.stallMs > input.timeoutMs || Date.now() - started > input.timeoutMs) {
    return {
      ok: false,
      category: 'timeout',
      code: 'sync.timeout',
      message: 'Source sync exceeded the timeout',
    };
  }
  const items = input.adapterName === 'fixture-catalog' ? CATALOG_ITEMS : PAGE_ITEMS;
  const offset = input.cursor == null || input.cursor === '' ? 0 : Number(input.cursor);
  if (!Number.isInteger(offset) || offset < 0 || offset > items.length) {
    return {
      ok: false,
      category: 'unsupported',
      code: 'page.cursor',
      message: 'The page cursor is not valid for this source',
    };
  }
  const count = Math.min(input.pageSize, input.itemLimit);
  const page = items.slice(offset, offset + count);
  const next = offset + page.length < items.length ? String(offset + page.length) : null;
  return {
    ok: true,
    items: page,
    nextCursor: next,
    capabilities: CAPABILITIES[input.adapterName],
  };
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
