#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INVENTORY_PATH = path.join(ROOT, 'docs', 'market', 'n01-plugin-inventory.md');

const SCOPES = [
  { kind: 'community', dir: 'packages/plugins/@nocobase' },
  { kind: 'example', dir: 'packages/plugins/@nocobase-example' },
  { kind: 'pro', dir: 'packages/pro-plugins/@nocobase' },
  { kind: 'core', dir: 'packages/core' },
  { kind: 'preset', dir: 'packages/presets' },
];

const DOCUMENTED_ABSENT = ['@nocobase/plugin-workflow-approval'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function listPackages(relativeDir) {
  const absoluteDir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }
  return fs
    .readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(absoluteDir, entry.name, 'package.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => readJson(filePath));
}

function cell(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (value === null || value === undefined || value === '') return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function row(pkg, kind, builtIn, presetDeprecated) {
  const meta = pkg.nocobase || {};
  return {
    name: pkg.name,
    version: pkg.version || '',
    kind,
    builtIn: builtIn.has(pkg.name),
    presetDeprecated: presetDeprecated.has(pkg.name),
    packageDeprecated: Boolean(meta.deprecated),
    editionLevel: meta.editionLevel === undefined ? '' : meta.editionLevel,
    license: pkg.license || '',
  };
}

function render(model) {
  const lines = [];
  lines.push('# Plugin inventory');
  lines.push('');
  lines.push('Regenerate this file with `node scripts/print-plugin-inventory.js --write`.');
  lines.push('');
  lines.push('The rows below are package metadata on disk. They do not include a git SHA.');
  lines.push('The verification note pins the commit.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Preset package \`${model.presetName}\` version \`${model.presetVersion}\`.`);
  lines.push(`- \`builtIn\` entries: ${model.builtIn.length}.`);
  lines.push(`- Preset \`deprecated\` entries: ${model.presetDeprecated.length}.`);
  lines.push(`- \`packages/pro-plugins/@nocobase\` exists: ${model.proDirExists ? 'yes' : 'no'}.`);
  lines.push(`- Package names containing \`market\`: ${model.marketNamed.length}.`);
  lines.push('');
  lines.push('| kind | packages |');
  lines.push('| --- | --- |');
  for (const scope of SCOPES) {
    const count = model.rows.filter((item) => item.kind === scope.kind).length;
    lines.push(`| ${scope.kind} | ${count} |`);
  }
  lines.push('');
  lines.push('## builtIn entries with no package.json in the scanned trees');
  lines.push('');
  if (model.missingBuiltIn.length === 0) {
    lines.push('None.');
  } else {
    for (const name of model.missingBuiltIn) {
      lines.push(`- \`${name}\``);
    }
  }
  lines.push('');
  lines.push('## Documented package names with no source package');
  lines.push('');
  if (model.absent.length === 0) {
    lines.push('None.');
  } else {
    for (const name of model.absent) {
      lines.push(`- \`${name}\``);
    }
  }
  lines.push('');
  lines.push('## Packages');
  lines.push('');
  lines.push('| name | version | kind | builtIn | presetDeprecated | packageDeprecated | editionLevel | license |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const item of model.rows) {
    lines.push(
      `| ${cell(item.name)} | ${cell(item.version)} | ${cell(item.kind)} | ${cell(item.builtIn)} | ${cell(item.presetDeprecated)} | ${cell(item.packageDeprecated)} | ${cell(item.editionLevel)} | ${cell(item.license)} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

function collect() {
  const presetPath = path.join(ROOT, 'packages/presets/nocobase/package.json');
  const preset = readJson(presetPath);
  const builtIn = new Set(preset.builtIn || []);
  const presetDeprecated = new Set(preset.deprecated || []);
  const proDirExists = fs.existsSync(path.join(ROOT, 'packages/pro-plugins/@nocobase'));
  const rows = [];
  for (const scope of SCOPES) {
    for (const pkg of listPackages(scope.dir)) {
      rows.push(row(pkg, scope.kind, builtIn, presetDeprecated));
    }
  }
  rows.sort((left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
  const present = new Set(rows.map((item) => item.name));
  return {
    sha: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    presetName: preset.name,
    presetVersion: preset.version,
    builtIn: [...builtIn].sort(),
    presetDeprecated: [...presetDeprecated].sort(),
    proDirExists,
    rows,
    missingBuiltIn: [...builtIn].filter((name) => !present.has(name)).sort(),
    absent: DOCUMENTED_ABSENT.filter((name) => !present.has(name)),
    marketNamed: rows.filter((item) => String(item.name).includes('market')).map((item) => item.name),
  };
}

function main() {
  const model = collect();
  const text = render(model);
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  const asJson = process.argv.includes('--json');

  if (check) {
    const current = fs.readFileSync(INVENTORY_PATH, 'utf8');
    if (current !== text) {
      process.stderr.write(`inventory drift: ${path.relative(ROOT, INVENTORY_PATH)}\n`);
      process.exit(1);
    }
    process.stdout.write(`inventory matches ${path.relative(ROOT, INVENTORY_PATH)}\n`);
    process.stdout.write(`HEAD ${model.sha} (${model.branch})\n`);
    return;
  }

  if (write) {
    fs.mkdirSync(path.dirname(INVENTORY_PATH), { recursive: true });
    fs.writeFileSync(INVENTORY_PATH, text);
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
    return;
  }

  process.stdout.write(text);
}

main();
