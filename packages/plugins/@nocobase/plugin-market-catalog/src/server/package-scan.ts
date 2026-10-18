/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { createHash } from 'crypto';

export const MANIFEST_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const PROFILE_NAMESPACE = 'com.example.agentmarket';
export const PUBLIC_MATERIALS = ['template', 'synthetic', 'explicitly_allowed'] as const;
export type PublicMaterial = (typeof PUBLIC_MATERIALS)[number];

const MAX_FILES = 32;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_UNZIP_BYTES = 1024 * 1024;
const MAX_UNZIP_RATIO = 10;

const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LICENSE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
const ENTRY_ID = /^[a-z][a-z0-9-]*$/;
const ENTRY_KINDS = ['skill', 'agent', 'mcp', 'squad', 'knowledge'];

const SECRET_RULES: Array<[string, RegExp]> = [
  ['aws_access_key', /AKIA[0-9A-Z]{16}/],
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['api_key', /sk-[A-Za-z0-9]{20,}/],
  ['api_key', /api[_-]?key\s*[:=]\s*\S+/i],
  ['password', /password\s*[:=]\s*\S+/i],
];

const PII_RULES: Array<[string, RegExp]> = [
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['phone', /\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/],
];

const SCRIPT_EXT = ['.sh', '.bash', '.ps1', '.bat', '.cmd'];
const BINARY_EXT = ['.exe', '.dll', '.so', '.dylib', '.bin'];

export type PackageFile = {
  path: string;
  content: string;
  uncompressedBytes?: number;
};

export type ScanInput = {
  manifest: unknown;
  files: unknown;
  sourceKey: string;
  resourceName: string;
  declaredDigest?: string;
};

export type ScanResult = {
  passed: boolean;
  digest: string;
  digestOk: boolean;
  structureOk: boolean;
  pathOk: boolean;
  sizeOk: boolean;
  licenseOk: boolean;
  sourceOk: boolean;
  secretsOk: boolean;
  secretFindings: string[];
  piiSignals: string[];
  scriptRisk: boolean;
  binaryRisk: boolean;
  license: string | null;
  version: string | null;
};

export const STANDARD_SAMPLE = {
  manifest: {
    $schema: MANIFEST_SCHEMA,
    name: 'notes',
    version: '0.1.0',
    description: 'Standard skill package with no market extension.',
    license: 'Apache-2.0',
  },
  files: [{ path: 'skills/notes/SKILL.md', content: '# Notes\nSynthetic template only.\n' }],
};

export const PROFILE_SAMPLE = {
  manifest: {
    $schema: MANIFEST_SCHEMA,
    name: 'research-agent',
    version: '0.1.0',
    license: 'Apache-2.0',
    extensions: {
      [PROFILE_NAMESPACE]: {
        namespaceStatus: 'placeholder',
        profileVersion: 'draft-1',
        resourceEntries: [
          { entryId: 'researcher', kind: 'agent', path: 'agents/researcher.json' },
          { entryId: 'notes', kind: 'skill', path: 'skills/notes/SKILL.md' },
        ],
        requiredCapabilities: ['agent.instantiate', 'resource.skill.install'],
        optionalCapabilities: [],
      },
    },
  },
  files: [
    { path: 'agents/researcher.json', content: '{"role":"researcher"}' },
    { path: 'skills/notes/SKILL.md', content: '# Notes\n' },
  ],
};

export function isReleaseId(value: string) {
  return RELEASE_ID.test(value);
}

export function packageDigest(manifest: unknown, files: PackageFile[]) {
  const body = JSON.stringify({
    files: [...files]
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
      .map((file) => ({ content: file.content, path: file.path })),
    manifest,
  });
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

export function scanPackage(input: ScanInput): ScanResult {
  const files = readFiles(input.files);
  const manifest = isRecord(input.manifest) ? input.manifest : null;
  const structure = manifest
    ? readStructure(manifest, input.resourceName, files)
    : { ok: false, license: null, version: null, entryPaths: [] as string[] };
  const paths = files ? files.map((file) => file.path).concat(structure.entryPaths) : structure.entryPaths;
  const pathOk = Boolean(files) && paths.every(isSafePath);
  const sizeOk = Boolean(files) && withinSize(files);
  const text = files ? files.map((file) => file.content).join('\n') : '';
  const secretFindings = unique(SECRET_RULES.filter(([, rule]) => rule.test(text)).map(([name]) => name));
  const piiSignals = unique(PII_RULES.filter(([, rule]) => rule.test(text)).map(([name]) => name));
  const scriptRisk = Boolean(files) && files.some(isScript);
  const binaryRisk = Boolean(files) && files.some(isBinary);
  const digest = files && manifest ? packageDigest(manifest, files) : '';
  const digestOk = digest.startsWith('sha256:') && (input.declaredDigest == null || input.declaredDigest === digest);
  const sourceOk = input.sourceKey.length > 0 && input.sourceKey.length <= 64;
  const passed =
    digestOk &&
    structure.ok &&
    pathOk &&
    sizeOk &&
    structure.license != null &&
    sourceOk &&
    secretFindings.length === 0 &&
    !scriptRisk &&
    !binaryRisk;
  return {
    passed,
    digest,
    digestOk,
    structureOk: structure.ok,
    pathOk,
    sizeOk,
    licenseOk: structure.license != null,
    sourceOk,
    secretsOk: secretFindings.length === 0,
    secretFindings,
    piiSignals,
    scriptRisk,
    binaryRisk,
    license: structure.license,
    version: structure.version,
  };
}

function readStructure(manifest: Record<string, unknown>, resourceName: string, files: PackageFile[] | null) {
  const license =
    typeof manifest.license === 'string' && LICENSE_TOKEN.test(manifest.license) ? manifest.license : null;
  const version =
    typeof manifest.version === 'string' && manifest.version.length > 0 && manifest.version.length <= 64
      ? manifest.version
      : null;
  const nameOk = manifest.name === resourceName;
  const schemaOk = manifest.$schema === MANIFEST_SCHEMA;
  const extension = readExtension(manifest.extensions);
  const filesOk = Boolean(files && files.length > 0);
  return {
    ok: Boolean(schemaOk && nameOk && version && license && extension.ok && filesOk),
    license,
    version,
    entryPaths: extension.paths,
  };
}

function readExtension(value: unknown) {
  if (value == null) {
    return { ok: true, paths: [] as string[] };
  }
  if (!isRecord(value)) {
    return { ok: false, paths: [] as string[] };
  }
  const profile = value[PROFILE_NAMESPACE];
  if (profile == null) {
    return { ok: true, paths: [] as string[] };
  }
  if (!isRecord(profile)) {
    return { ok: false, paths: [] as string[] };
  }
  if (profile.namespaceStatus !== 'placeholder' || profile.profileVersion !== 'draft-1') {
    return { ok: false, paths: [] as string[] };
  }
  if (!Array.isArray(profile.resourceEntries) || profile.resourceEntries.length === 0) {
    return { ok: false, paths: [] as string[] };
  }
  const paths: string[] = [];
  for (const entry of profile.resourceEntries) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== 'string' ||
      typeof entry.entryId !== 'string' ||
      typeof entry.kind !== 'string'
    ) {
      return { ok: false, paths };
    }
    if (!ENTRY_ID.test(entry.entryId) || !ENTRY_KINDS.includes(entry.kind)) {
      return { ok: false, paths };
    }
    paths.push(entry.path);
  }
  return { ok: true, paths };
}

function readFiles(value: unknown): PackageFile[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FILES) {
    return null;
  }
  const files: PackageFile[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.path !== 'string' || typeof item.content !== 'string') {
      return null;
    }
    const file: PackageFile = { path: item.path, content: item.content };
    if (item.uncompressedBytes != null) {
      if (
        typeof item.uncompressedBytes !== 'number' ||
        !Number.isInteger(item.uncompressedBytes) ||
        item.uncompressedBytes < item.content.length
      ) {
        return null;
      }
      file.uncompressedBytes = item.uncompressedBytes;
    }
    files.push(file);
  }
  return files;
}

function withinSize(files: PackageFile[]) {
  let total = 0;
  for (const file of files) {
    const bytes = Buffer.byteLength(file.content);
    const unzipped = file.uncompressedBytes ?? bytes;
    if (bytes > MAX_FILE_BYTES || unzipped > MAX_UNZIP_BYTES) {
      return false;
    }
    if (file.uncompressedBytes != null && file.uncompressedBytes > bytes * MAX_UNZIP_RATIO) {
      return false;
    }
    total += unzipped;
  }
  return total <= MAX_TOTAL_BYTES;
}

export function isSafePath(path: string) {
  if (path.length === 0 || path.length > 200) {
    return false;
  }
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  return path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function isScript(file: PackageFile) {
  return SCRIPT_EXT.some((ext) => file.path.endsWith(ext)) || file.content.startsWith('#!');
}

function isBinary(file: PackageFile) {
  return (
    BINARY_EXT.some((ext) => file.path.endsWith(ext)) ||
    file.content.startsWith('MZ') ||
    file.content.startsWith('\u007fELF')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: string[]) {
  return [...new Set(values)];
}
