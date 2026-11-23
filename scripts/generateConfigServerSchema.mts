/**
 * Generates the JSON Schema that config-server uses to validate the "basemaps" config this service stores.
 *
 * Source of truth: the Zod schemas in `@map-colonies/app-shared`. The stored config is
 * `{ basemaps: PersistedBasemap[] }` (see `IConfigServerDocument`): the `config` field of a config-server
 * `POST /api/config` request. The request envelope (`configName`, `schemaId`, `version`) is config-server's own
 * contract and is not part of this schema.
 *
 * Output: `v1.schema.json` next to this script, copied unchanged into
 * `schemas/common/basemaps/v1.schema.json` in the MapColonies `schemas` repository. A unit test fails when the
 * committed file no longer matches what the Zod schemas generate.

 * Run with `npm run generate:config-server-schema` (plain Node, native type stripping).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { format, resolveConfig } from 'prettier';
import { PersistedBasemapSchema } from '@map-colonies/app-shared';

const DEFAULT_CONFIG_FILE = path.join(import.meta.dirname, '..', 'config', 'default.json');
const { configServer } = z
  .object({ configServer: z.object({ configName: z.string().min(1), schemaId: z.string().min(1) }) })
  .parse(JSON.parse(readFileSync(DEFAULT_CONFIG_FILE, 'utf8')));

const SCHEMA_ID = configServer.schemaId;
const SCHEMA_TITLE = configServer.configName;
const SCHEMA_FILE = path.join(import.meta.dirname, 'v1.schema.json');

type JsonSchema = Record<string, unknown>;

function buildBasemapsConfigJsonSchema(): JsonSchema {
  const configSchema = z.object({
    basemaps: z.array(PersistedBasemapSchema),
  });

  const generated = zodToJsonSchema(configSchema, { target: 'jsonSchema2019-09', $refStrategy: 'none' }) as JsonSchema;
  delete generated.$schema;

  if (JSON.stringify(generated).includes('"$ref"')) {
    throw new Error('the generated config schema contains a $ref; it must be fully inlined');
  }

  return {
    $id: SCHEMA_ID,
    title: SCHEMA_TITLE,
    description: 'Generated from the @map-colonies/app-shared Zod schemas by basemap-management - do not edit by hand.',
    ...generated,
  };
}

async function serializeBasemapsConfigJsonSchema(schema: JsonSchema): Promise<string> {
  const options = await resolveConfig(SCHEMA_FILE);
  return format(JSON.stringify(schema), { ...options, parser: 'json' });
}

async function main(): Promise<void> {
  writeFileSync(SCHEMA_FILE, await serializeBasemapsConfigJsonSchema(buildBasemapsConfigJsonSchema()));
  console.log(`wrote ${path.relative(process.cwd(), SCHEMA_FILE)}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { SCHEMA_ID, SCHEMA_TITLE, SCHEMA_FILE, buildBasemapsConfigJsonSchema, serializeBasemapsConfigJsonSchema };
export type { JsonSchema };
