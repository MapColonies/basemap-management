#!/usr/bin/env node
/**
 * Generates the JSON Schema for `IConfigServerDocument` (`{ basemaps: PersistedBasemap[] }`),
 * derived from `PersistedBasemapSchema` in `@map-colonies/app-shared` - the same zod schema that
 * validates basemaps at runtime.
 *
 * Usage:
 *   node scripts/generateConfigServerSchema.js [--output <schema.json>] [--schema-id <uri>]
 *
 * --output (-o) defaults to schemas/v1.schema.json in this repository, wherever the script is run from;
 *   an explicit relative path is resolved against the current working directory.
 * --schema-id defaults to configServer.schemaId in config/default.json (the title is configServer.configName).
 * Both options also accept the --option=value form.
 *
 * The output is formatted with this repository's Prettier configuration, so it can be copied as is
 * to schemas/common/basemaps/v1.schema.json in the @map-colonies/schemas repository.
 *
 * On top of the zod-derived shape, the generated schema also adds cross-item rules that
 * zod/zod-to-json-schema can't express on their own:
 *   - at most one basemap may have isCurrent: true (zero is allowed)
 *   - at most one basemap may have isForPreview: true (zero is allowed)
 * Unique basemap ids, unique layer ids and unique layer orders are enforced by basemap-management only:
 * standard JSON Schema can't express them, and config-server's Ajv registers no custom keywords for them.
 */

const fs = require('node:fs');
const path = require('node:path');
const prettier = require('prettier');
const { z } = require('zod');
const { PersistedBasemapSchema } = require('@map-colonies/app-shared');
const { zodToJsonSchema } = require('zod-to-json-schema');

const DEFAULT_OUTPUT = path.join(__dirname, '..', 'schemas', 'v1.schema.json');
const { configServer } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default.json'), 'utf8'));
const DEFAULT_SCHEMA_ID = configServer.schemaId;
const TITLE = configServer.configName;
const DESCRIPTION = 'Generated from the @map-colonies/app-shared Zod schemas by basemap-management - do not edit by hand.';

const OPTIONS = new Map([
  ['--output', 'output'],
  ['-o', 'output'],
  ['--schema-id', 'schemaId'],
]);
const USAGE = 'usage: node scripts/generateConfigServerSchema.js [--output <schema.json>] [--schema-id <uri>]';

function parseArgs(argv) {
  const args = { output: undefined, schemaId: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const inline = arg.startsWith('--') && arg.includes('=');
    const flag = inline ? arg.slice(0, arg.indexOf('=')) : arg;
    const key = OPTIONS.get(flag);
    if (key === undefined) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = inline ? arg.slice(flag.length + 1) : argv[(i += 1)];
    if (value === undefined || value.trim() === '' || (!inline && value.startsWith('-'))) {
      throw new Error(`missing value for ${flag}`);
    }
    args[key] = value;
  }
  return args;
}

function atMostOneWhere(properties) {
  return {
    contains: {
      type: 'object',
      properties,
      required: Object.keys(properties),
    },
    minContains: 0,
    maxContains: 1,
  };
}

function applyUniquenessRules(jsonSchema) {
  const basemaps = jsonSchema.properties.basemaps;
  basemaps.allOf = [atMostOneWhere({ isCurrent: { const: true } }), atMostOneWhere({ isForPreview: { const: true } })];
  return jsonSchema;
}

function buildSchema(schemaId = DEFAULT_SCHEMA_ID) {
  const ConfigServerDocumentSchema = z.object({ basemaps: z.array(PersistedBasemapSchema) });
  const jsonSchema = zodToJsonSchema(ConfigServerDocumentSchema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  });
  delete jsonSchema.$schema;
  if (JSON.stringify(jsonSchema).includes('"$ref"')) {
    throw new Error('the generated schema contains a $ref; it must be fully inlined');
  }
  applyUniquenessRules(jsonSchema);

  return { $id: schemaId, title: TITLE, description: DESCRIPTION, ...jsonSchema };
}

async function serializeSchema(schema) {
  const options = await prettier.resolveConfig(DEFAULT_OUTPUT);
  return prettier.format(JSON.stringify(schema, null, 2), { ...options, parser: 'json' });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const { output, schemaId } = args;

  const resolvedOutput = output === undefined ? DEFAULT_OUTPUT : path.resolve(output);
  const text = await serializeSchema(buildSchema(schemaId));
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, text);
  console.log(`generated IConfigServerDocument JSON schema -> ${resolvedOutput}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { DEFAULT_OUTPUT, DEFAULT_SCHEMA_ID, parseArgs, buildSchema, serializeSchema };
