#!/usr/bin/env node
/**
 * Generates the JSON Schema for `IConfigServerDocument` (`{ basemaps: PersistedBasemap[] }`),
 * derived from `PersistedBasemapSchema` in `@map-colonies/app-shared` - the same zod schema that
 * validates basemaps at runtime - so the generated schema can't drift from actual validation.
 *
 * Usage:
 *   node scripts/generateConfigServerSchema.js [--output <schema.json>] [--schema-id <uri>]
 *
 * --output defaults to schemas/v1.schema.json (relative to the repo root).
 * --schema-id defaults to this schema's `$id` in the `@map-colonies/schemas` repo.
 *
 * On top of the zod-derived shape, the generated schema also adds cross-item uniqueness rules that
 * zod/zod-to-json-schema can't express on their own:
 *   - at most one basemap may have isCurrent: true
 *   - at most one basemap may have isForPreview: true
 *   - within a basemap, layers[].order must be unique (via the ajv-keywords `uniqueItemProperties`
 *     keyword - only enforced if ajv-keywords is registered wherever this schema is validated)
 */

const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { PersistedBasemapSchema } = require('@map-colonies/app-shared');
const { zodToJsonSchema } = require('zod-to-json-schema');

const DEFAULT_OUTPUT = path.join('schemas', 'v1.schema.json');
const DEFAULT_SCHEMA_ID = 'https://mapcolonies.com/common/basemaps/v1';
const TITLE = 'basemaps';
const DESCRIPTION = 'Generated from the @map-colonies/app-shared Zod schemas by basemap-management - do not edit by hand.';

function parseArgs(argv) {
  const args = { output: undefined, schemaId: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output' || arg === '-o') {
      args.output = argv[(i += 1)];
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
    } else if (arg === '--schema-id') {
      args.schemaId = argv[(i += 1)];
    } else if (arg.startsWith('--schema-id=')) {
      args.schemaId = arg.slice('--schema-id='.length);
    }
  }
  return args;
}

/**
 * At most one array item may match `properties`. Native JSON Schema 2019-09 (contains + maxContains),
 * no plugins required.
 */
function atMostOneWhere(properties) {
  return { contains: { properties, required: Object.keys(properties) }, maxContains: 1 };
}

function applyUniquenessRules(jsonSchema) {
  const basemaps = jsonSchema.properties.basemaps;
  basemaps.allOf = [atMostOneWhere({ isCurrent: { const: true } }), atMostOneWhere({ isForPreview: { const: true } })];
  basemaps.items.properties.layers.uniqueItemProperties = ['order'];
  return jsonSchema;
}

function main() {
  const { output, schemaId } = parseArgs(process.argv.slice(2));

  const ConfigServerDocumentSchema = z.object({ basemaps: z.array(PersistedBasemapSchema) });
  const jsonSchema = zodToJsonSchema(ConfigServerDocumentSchema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  });
  delete jsonSchema.$schema;
  applyUniquenessRules(jsonSchema);

  const withId = { $id: schemaId ?? DEFAULT_SCHEMA_ID, title: TITLE, description: DESCRIPTION, ...jsonSchema };

  const resolvedOutput = path.resolve(output ?? DEFAULT_OUTPUT);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(withId, null, 2)}\n`);
  console.log(`generated IConfigServerDocument JSON schema -> ${resolvedOutput}`);
}

main();
