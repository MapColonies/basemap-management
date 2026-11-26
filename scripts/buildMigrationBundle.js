#!/usr/bin/env node
/**
 * Bundles scripts/migrateBasemaps.js together with all of its runtime dependencies
 * (@map-colonies/app-shared, @map-colonies/types, zod, ...) into ONE self-contained CommonJS file
 * that runs with nothing but Node.js: no npm install, no node_modules, no BMM checkout, no network.
 * It's meant to be copied as-is into networks that have no npm registry access.
 *
 * Usage:
 *   node scripts/buildMigrationBundle.js [--output <file>]
 *
 * --output (-o) defaults to dist/migration/migrateBasemaps.js in this repository, wherever the script
 *   is run from; an explicit relative path is resolved against the current working directory.
 *   Also accepts the --output=<file> form. Invalid arguments exit with code 2.
 *
 * Next to the bundle, a `<bundle>.sha256` file is written in `sha256sum` format so the copy can be
 * checked after the transfer (`sha256sum -c migrateBasemaps.js.sha256`).
 *
 * The migration source is bundled unchanged: the bundle validates with the real PersistedBasemapSchema
 * and enums from the installed @map-colonies packages, so rebuild it whenever those change.
 *
 * The build fails if the bundle still requires anything other than Node.js built-in modules, so a
 * successful build is always standalone. The output is deterministic (no timestamps): rebuilding from
 * the same lockfile produces a byte-identical file.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const { isBuiltin } = require('node:module');
const path = require('node:path');
const { build } = require('rolldown');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(__dirname, 'migrateBasemaps.js');
const DEFAULT_OUTPUT = path.join(ROOT, 'dist', 'migration', 'migrateBasemaps.js');
const USAGE = 'Usage: node scripts/buildMigrationBundle.js [--output <file>]';
const MIN_NODE_VERSION = '18';

/**
 * Modules that the dependency graph loads but the migration never uses, replaced in the bundle by a
 * stub that throws as soon as anything reads from it - so if a future migration change starts using
 * one, it fails loudly instead of silently working with empty data.
 */
const OMITTED_MODULES = [
  {
    // `require('@map-colonies/types')` loads every enum, including EPSGDATA: an 8.6MB EPSG
    // database (>95% of the bundle) that the migration doesn't touch.
    id: '@map-colonies/types/dist/enums/geo/epsg-index/all.json',
    usedBy: 'EPSGDATA from @map-colonies/types',
  },
];

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output' || arg === '-o') {
      const value = argv[(i += 1)];
      if (value === undefined || value.startsWith('-')) {
        throw new UsageError(`${arg} requires a value`);
      }
      args.output = path.resolve(value);
    } else if (arg.startsWith('--output=')) {
      args.output = path.resolve(arg.slice('--output='.length));
    } else {
      throw new UsageError(`unknown argument "${arg}"`);
    }
  }
  return args;
}

function toPosix(id) {
  return id.split(path.sep).join('/');
}

function findOmittedModule(id) {
  const posixId = toPosix(id);
  return OMITTED_MODULES.find((omitted) => posixId.endsWith(`/node_modules/${omitted.id}`));
}

function omittedModuleStub(omitted) {
  const message = `${omitted.id} (${omitted.usedBy}) was omitted from the standalone migration bundle because the migration doesn't use it - see OMITTED_MODULES in scripts/buildMigrationBundle.js`;
  return [
    `const message = ${JSON.stringify(message)};`,
    // Module interop may probe these; anything else is a real read of the omitted data.
    `const interopKeys = new Set(['__esModule', 'default', 'then']);`,
    `module.exports = new Proxy({}, {`,
    `  get(target, key) {`,
    `    if (typeof key === 'symbol' || interopKeys.has(key)) return undefined;`,
    `    throw new Error(message);`,
    `  },`,
    `});`,
  ].join('\n');
}

const omitModulesPlugin = {
  name: 'omit-unused-modules',
  load(id) {
    const omitted = findOmittedModule(id);
    return omitted === undefined ? null : { code: omittedModuleStub(omitted), moduleType: 'js' };
  },
};

/** Maps bundled module files to the npm packages they belong to (name, version, license, license text). */
function collectBundledPackages(moduleIds) {
  const packages = new Map();
  for (const id of moduleIds) {
    const posixId = toPosix(id);
    const marker = posixId.lastIndexOf('/node_modules/');
    if (marker === -1) {
      continue;
    }
    const rest = posixId.slice(marker + '/node_modules/'.length).split('/');
    const nameParts = rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1);
    const packageDir = path.join(posixId.slice(0, marker), 'node_modules', ...nameParts);
    if (packages.has(packageDir)) {
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const licenseFile = fs.readdirSync(packageDir).find((file) => /^licen[cs]e(\.|$)/i.test(file));
    packages.set(packageDir, {
      name: manifest.name,
      version: manifest.version,
      license: manifest.license ?? 'UNKNOWN',
      licenseText: licenseFile === undefined ? undefined : fs.readFileSync(path.join(packageDir, licenseFile), 'utf8').trim(),
    });
  }
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Makes arbitrary text safe to embed in a block comment. */
function asCommentLines(text) {
  return text
    .replaceAll('*/', '* /')
    .split(/\r?\n/)
    .map((line) => ` * ${line}`.trimEnd());
}

function createBanner(packages) {
  const { name, version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return [
    '/*!',
    ` * Standalone basemap migration utility, generated from scripts/migrateBasemaps.js by \`npm run build:migration\` in ${name}@${version}. Do not edit.`,
    ` * Runs with Node.js >= ${MIN_NODE_VERSION} on any OS/CPU; needs no other file, npm package or network access.`,
    ' *',
    ' *   node migrateBasemaps.js --input <oldFormat.json> --output <migrated.json> [--resolve-wmts-as-external[=true|false]]',
    ' *',
    ' * Bundled packages (license texts at the end of this file):',
    ...packages.map((pkg) => ` *   ${pkg.name}@${pkg.version} (${pkg.license})`),
    ' * Omitted (unused by the migration; replaced with a stub that throws if read):',
    ...OMITTED_MODULES.map((omitted) => ` *   ${omitted.id} (${omitted.usedBy})`),
    ' */',
  ].join('\n');
}

function createFooter(packages) {
  const lines = ['/*!', ' * Third-party licenses', ' *'];
  for (const pkg of packages) {
    lines.push(` * ${pkg.name}@${pkg.version} - ${pkg.license}`);
    lines.push(...(pkg.licenseText === undefined ? [' * (no license file in the package)'] : asCommentLines(pkg.licenseText)));
    lines.push(' *');
  }
  lines.push(' */');
  return lines.join('\n');
}

/** Throws unless every `require()` left in the bundle is a Node.js built-in with a static specifier. */
function assertStandalone(code) {
  const problems = [];
  for (const match of code.matchAll(/\brequire\s*\(\s*(?:(["'`])([^"'`]*)\1\s*\)|([^\s)]))/g)) {
    const specifier = match[2];
    if (specifier === undefined) {
      problems.push(`dynamic require starting with "${match[3]}"`);
    } else if (!isBuiltin(specifier)) {
      problems.push(`require("${specifier}")`);
    }
  }
  if (/\bimport\s*\(/.test(code)) {
    problems.push('dynamic import()');
  }
  if (problems.length > 0) {
    throw new Error(`the bundle is not standalone, it still loads: ${[...new Set(problems)].join(', ')}`);
  }
}

async function bundle(output) {
  const result = await build({
    input: ENTRY,
    platform: 'node',
    logLevel: 'warn',
    plugins: [omitModulesPlugin],
    write: false,
    output: { format: 'cjs', codeSplitting: false },
  });
  const chunks = result.output.filter((item) => item.type === 'chunk');
  if (chunks.length !== 1 || result.output.length !== 1) {
    throw new Error(`expected exactly one output chunk, got: ${result.output.map((item) => item.fileName).join(', ')}`);
  }
  const [chunk] = chunks;
  assertStandalone(chunk.code);

  const packages = collectBundledPackages(chunk.moduleIds);
  const shebangMatch = /^#![^\n]*\n/.exec(chunk.code);
  const shebang = shebangMatch === null ? '#!/usr/bin/env node\n' : shebangMatch[0];
  const body = shebangMatch === null ? chunk.code : chunk.code.slice(shebang.length);
  const code = `${shebang}${createBanner(packages)}\n${body.trimEnd()}\n\n${createFooter(packages)}\n`;

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, code, { mode: 0o755 });
  const sha256 = crypto.createHash('sha256').update(code).digest('hex');
  fs.writeFileSync(`${output}.sha256`, `${sha256}  ${path.basename(output)}\n`);
  return { output, size: Buffer.byteLength(code), sha256, packages };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  const { output, size, sha256, packages } = await bundle(args.output);
  console.log(`built standalone migration utility -> ${path.relative(process.cwd(), output) || output}`);
  console.log(`  size:     ${(size / 1024).toFixed(1)} KiB`);
  console.log(`  sha256:   ${sha256}`);
  console.log(`  bundled:  ${packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`);
  console.log(`  omitted:  ${OMITTED_MODULES.map((omitted) => omitted.id).join(', ')}`);
}

module.exports = { DEFAULT_OUTPUT, OMITTED_MODULES, assertStandalone, parseArgs };

if (require.main === module) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
