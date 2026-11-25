/* eslint-disable @typescript-eslint/naming-convention */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ajv2019 } from 'ajv/dist/2019';
import type { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { load } from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { PersistedBasemapSchema, type PersistedBasemap } from '@map-colonies/app-shared';
import { MOCK_PERSISTED_BASEMAPS } from '@src/basemaps/mock/mockBasemaps';
import { findCollectionConflicts, findLayerConflicts } from '@src/basemaps/models/basemapInvariants';

type JsonSchema = Record<string, unknown>;

const ROOT = process.cwd();
const GENERATOR = path.join(ROOT, 'scripts', 'generateConfigServerSchema.js');
const SCHEMA_FILE = path.join(ROOT, 'schemas', 'v1.schema.json');

interface IGeneratorArgs {
  output?: string;
  schemaId?: string;
}
interface IGenerator {
  DEFAULT_OUTPUT: string;
  DEFAULT_SCHEMA_ID: string;
  parseArgs: (argv: string[]) => IGeneratorArgs;
}
const generator = createRequire(path.join(ROOT, 'package.json'))(GENERATOR) as IGenerator;

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'bmm-schema-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function generateSchemaText(): string {
  return withTempDir((dir) => {
    const output = path.join(dir, 'v1.schema.json');
    execFileSync(process.execPath, [GENERATOR, '--output', output], { cwd: ROOT, stdio: 'pipe' });
    return readFileSync(output, 'utf8');
  });
}

const SCHEMA_ID = (JSON.parse(generateSchemaText()) as { $id: string }).$id;

const StoredConfigSchema = z.object({ basemaps: z.array(PersistedBasemapSchema) });

function createConfigServerAjv(): Ajv2019 {
  const ajv = addFormats(
    new Ajv2019({
      keywords: ['x-env-value', 'x-env-format'],
      discriminator: true,
      useDefaults: true,
    })
  );
  const draft7MetaSchema = createRequire(path.join(ROOT, 'package.json'))('ajv/dist/refs/json-schema-draft-07.json') as object;
  ajv.addMetaSchema(draft7MetaSchema, 'http://json-schema.org/draft-07/schema#');
  return ajv;
}

const committedSchema = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')) as JsonSchema;
let compiledValidator: ValidateFunction | undefined;
function validateWithConfigServerAjv(config: unknown): boolean {
  compiledValidator ??= createConfigServerAjv().compile(committedSchema);
  return compiledValidator(config);
}

function jsonSchemaAccepts(config: unknown): boolean {
  return validateWithConfigServerAjv(structuredClone(config));
}

const [externalAndCatalogBasemap] = MOCK_PERSISTED_BASEMAPS as [PersistedBasemap, ...PersistedBasemap[]];
const catalogLayer = externalAndCatalogBasemap.layers.find((layer) => layer.source.type === 'CATALOG_RESOURCE')!;
const externalLayer = externalAndCatalogBasemap.layers.find((layer) => layer.source.type === 'EXTERNAL')!;

function basemapWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(externalAndCatalogBasemap), ...overrides };
}

function withLayer(layer: unknown): { basemaps: unknown[] } {
  return { basemaps: [basemapWith({ layers: [layer] })] };
}

const VALID_CONFIGS: [string, unknown][] = [
  ['an empty basemap collection', { basemaps: [] }],
  ['all mock-mode fixtures (multiple basemaps, catalog and external layers, unknown product)', { basemaps: MOCK_PERSISTED_BASEMAPS }],
  ['a basemap with no layers', { basemaps: [basemapWith({ layers: [] })] }],
  [
    'a catalog layer whose uniqueness fields are null',
    withLayer({ ...catalogLayer, source: { ...catalogLayer.source, uniqueness: { productId: null, productType: null } } }),
  ],
  ['a catalog layer whose uniqueness fields are omitted', withLayer({ ...catalogLayer, source: { ...catalogLayer.source, uniqueness: {} } })],
  ['a layer without shouldBeUsedInModelDraping', withLayer({ ...catalogLayer, shouldBeUsedInModelDraping: undefined })],
  [
    'an external layer with provider-specific extras (extras is .passthrough())',
    withLayer({
      ...externalLayer,
      source: { type: 'EXTERNAL', details: { protocol: 'WMTS', name: 'n', url: 'u', extras: { matrixSet: 'EPSG:3857', style: 'default' } } },
    }),
  ],
];

const INVALID_CONFIGS: [string, unknown][] = [
  ['a config without basemaps', {}],
  ['basemaps that is not an array', { basemaps: {} }],
  ['a basemap without an id', { basemaps: [basemapWith({ id: undefined })] }],
  ['a basemap without a name', { basemaps: [basemapWith({ name: undefined })] }],
  ['an empty name', { basemaps: [basemapWith({ name: '' })] }],
  ['a non-boolean role flag', { basemaps: [basemapWith({ isCurrent: 'yes' })] }],
  ['a thumbnail that is not 128x128', { basemaps: [basemapWith({ thumbnail: { url: 'data:', width: 64, height: 128 } })] }],
  ['a thumbnail without a url', { basemaps: [basemapWith({ thumbnail: { width: 128, height: 128 } })] }],
  ['layers that is not an array', { basemaps: [basemapWith({ layers: {} })] }],
  ['a layer without an id', withLayer({ ...catalogLayer, id: undefined })],
  ['a negative layer order', withLayer({ ...catalogLayer, order: -1 })],
  ['a fractional layer order', withLayer({ ...catalogLayer, order: 0.5 })],
  ['an opacity above 1', withLayer({ ...catalogLayer, opacity: 1.5 })],
  ['a non-boolean shouldBeUsedInModelDraping', withLayer({ ...catalogLayer, shouldBeUsedInModelDraping: 'yes' })],
  ['an unknown source type', withLayer({ ...catalogLayer, source: { ...catalogLayer.source, type: 'WMS' } })],
  ['an unknown catalog domain', withLayer({ ...catalogLayer, source: { ...catalogLayer.source, domain: 'VECTOR' } })],
  ['a catalog layer without uniqueness', withLayer({ ...catalogLayer, source: { type: 'CATALOG_RESOURCE', domain: 'RASTER' } })],
  ['a non-string productId', withLayer({ ...catalogLayer, source: { ...catalogLayer.source, uniqueness: { productId: 1 } } })],
  ['an external layer without details', withLayer({ ...externalLayer, source: { type: 'EXTERNAL' } })],
  ['external details without a url', withLayer({ ...externalLayer, source: { type: 'EXTERNAL', details: { protocol: 'XYZ', name: 'n' } } })],
  ['a non-string external protocol', withLayer({ ...externalLayer, source: { type: 'EXTERNAL', details: { protocol: 1, name: 'n', url: 'u' } } })],
];

const UNKNOWN_KEY_CONFIGS: [string, unknown][] = [
  ['the root config', { basemaps: [], unknown: 1 }],
  ['a basemap', { basemaps: [basemapWith({ unknown: 1 })] }],
  ['a thumbnail', { basemaps: [basemapWith({ thumbnail: { url: 'data:', width: 128, height: 128, unknown: 1 } })] }],
  ['a layer', withLayer({ ...catalogLayer, unknown: 1 })],
  [
    'a catalog source (read-time resolution fields)',
    withLayer({ ...catalogLayer, source: { ...catalogLayer.source, status: 'RESOLVED', layer: null, capabilities: null } }),
  ],
  ['a catalog uniqueness', withLayer({ ...catalogLayer, source: { ...catalogLayer.source, uniqueness: { productId: 'p', unknown: 1 } } })],
  ['an external source', withLayer({ ...externalLayer, source: { ...externalLayer.source, unknown: 1 } })],
  [
    'external details (provider-specific keys belong in extras)',
    withLayer({ ...externalLayer, source: { type: 'EXTERNAL', details: { protocol: 'WMTS', name: 'n', url: 'u', matrixSet: 'EPSG:3857' } } }),
  ],
  ['a source mixing both branches', withLayer({ ...externalLayer, source: { ...externalLayer.source, domain: 'RASTER', uniqueness: {} } })],
];

const roleBasemap = (id: string, isCurrent: boolean, isForPreview: boolean): Record<string, unknown> => basemapWith({ id, isCurrent, isForPreview });

const ROLE_CONFIGS: [string, { basemaps: unknown[] }, boolean][] = [
  ['no current and no preview basemap', { basemaps: [roleBasemap('a', false, false), roleBasemap('b', false, false)] }, true],
  ['one current basemap', { basemaps: [roleBasemap('a', true, false), roleBasemap('b', false, false)] }, true],
  ['one preview basemap', { basemaps: [roleBasemap('a', false, true), roleBasemap('b', false, false)] }, true],
  ['one basemap both current and for preview', { basemaps: [roleBasemap('a', true, true), roleBasemap('b', false, false)] }, true],
  ['one current and a different preview basemap', { basemaps: [roleBasemap('a', true, false), roleBasemap('b', false, true)] }, true],
  ['two current basemaps', { basemaps: [roleBasemap('a', true, false), roleBasemap('b', true, false)] }, false],
  ['two preview basemaps', { basemaps: [roleBasemap('a', false, true), roleBasemap('b', false, true)] }, false],
  ['two current basemaps, one of them also for preview', { basemaps: [roleBasemap('a', true, true), roleBasemap('b', true, false)] }, false],
  ['two preview basemaps, one of them also current', { basemaps: [roleBasemap('a', true, true), roleBasemap('b', false, true)] }, false],
  ['three current basemaps', { basemaps: ['a', 'b', 'c'].map((id) => roleBasemap(id, true, false)) }, false],
];

const twoLayers = (second: Record<string, unknown>): unknown[] => [catalogLayer, { ...catalogLayer, ...second }];

const BMM_ONLY_INVARIANTS: [string, { basemaps: Record<string, unknown>[] }][] = [
  ['duplicate basemap ids', { basemaps: [roleBasemap('a', false, false), roleBasemap('a', false, false)] }],
  ['duplicate layer ids within a basemap', { basemaps: [basemapWith({ layers: twoLayers({ order: catalogLayer.order + 1 }) })] }],
  ['duplicate layer orders within a basemap', { basemaps: [basemapWith({ layers: twoLayers({ id: 'other' }) })] }],
];

function bmmConflicts(config: { basemaps: unknown[] }): string[] {
  return [
    ...findCollectionConflicts(config.basemaps),
    ...config.basemaps.flatMap((basemap) => findLayerConflicts((basemap as PersistedBasemap).layers)),
  ];
}

const KNOWN_GAPS: [string, unknown][] = [
  ['a blank (whitespace-only) name', { basemaps: [basemapWith({ name: '   ' })] }],
  ['a blank thumbnail url', { basemaps: [basemapWith({ thumbnail: { url: ' ', width: 128, height: 128 } })] }],
  [
    'blank external details name/url',
    withLayer({ ...externalLayer, source: { type: 'EXTERNAL', details: { protocol: 'XYZ', name: ' ', url: ' ' } } }),
  ],
];

function collectObjectSchemas(schema: unknown, pointer = ''): Map<string, JsonSchema> {
  const found = new Map<string, JsonSchema>();
  if (typeof schema !== 'object' || schema === null) {
    return found;
  }
  const node = schema as JsonSchema;
  if (node.type === 'object') {
    found.set(pointer, node);
  }
  for (const [key, child] of Object.entries(node)) {
    for (const [childPointer, childSchema] of collectObjectSchemas(child, `${pointer}/${key}`)) {
      found.set(childPointer, childSchema);
    }
  }
  return found;
}

const SOURCE = '/properties/basemaps/items/properties/layers/items/properties/source';
const CLOSED_OBJECTS = [
  '',
  '/properties/basemaps/items',
  '/properties/basemaps/items/properties/thumbnail',
  '/properties/basemaps/items/properties/layers/items',
  `${SOURCE}/anyOf/0`,
  `${SOURCE}/anyOf/0/properties/uniqueness`,
  `${SOURCE}/anyOf/1`,
  `${SOURCE}/anyOf/1/properties/details`,
];
const OPEN_OBJECTS = [`${SOURCE}/anyOf/1/properties/details/properties/extras`];
const MATCHER_OBJECTS = ['/properties/basemaps/allOf/0/contains', '/properties/basemaps/allOf/1/contains'];

describe('basemaps config JSON Schema (config-server)', () => {
  describe('generation', () => {
    it('should match the committed schemas/v1.schema.json (run `npm run generate:config-server-schema` if this fails)', () => {
      const generated = generateSchemaText();

      expect(readFileSync(SCHEMA_FILE, 'utf8')).toBe(generated);
    });

    it('should generate identically on every run', () => {
      const first = generateSchemaText();
      const second = generateSchemaText();

      expect(second).toBe(first);
    });

    it('should be standalone JSON Schema: fully inlined, no OpenAPI keywords, no $schema (schemas repository convention)', () => {
      const text = JSON.stringify(committedSchema);

      expect(text).not.toContain('"$ref"');
      expect(text).not.toContain('"definitions"');
      expect(text).not.toContain('"$defs"');
      expect(text).not.toContain('"nullable"');
      expect(text).not.toContain('"discriminator"');
      expect(committedSchema).not.toHaveProperty('$schema');
    });
  });

  describe('command line', () => {
    it.each<[string[], IGeneratorArgs]>([
      [[], { output: undefined, schemaId: undefined }],
      [['--output', 'a.json', '--schema-id', 'https://example.com/x'], { output: 'a.json', schemaId: 'https://example.com/x' }],
      [['-o', 'a.json'], { output: 'a.json', schemaId: undefined }],
      [['--output=a.json', '--schema-id=https://example.com/x'], { output: 'a.json', schemaId: 'https://example.com/x' }],
    ])('should parse %j', (argv, expected) => {
      expect(generator.parseArgs(argv)).toEqual(expected);
    });

    it.each<[string[], string]>([
      [['--ouput=a.json'], 'unknown argument: --ouput=a.json'],
      [['a.json'], 'unknown argument: a.json'],
      [['-o=a.json'], 'unknown argument: -o=a.json'],
      [['--output'], 'missing value for --output'],
      [['--output', '--schema-id', 'x'], 'missing value for --output'],
      [['--output='], 'missing value for --output'],
      [['--schema-id', ' '], 'missing value for --schema-id'],
      [['--schema-id='], 'missing value for --schema-id'],
    ])('should reject %j', (argv, message) => {
      expect(() => generator.parseArgs(argv)).toThrow(message);
    });

    it('should default to schemas/v1.schema.json in this repository and to the configured schemaId', () => {
      const defaultConfig = JSON.parse(readFileSync(path.join(ROOT, 'config', 'default.json'), 'utf8')) as { configServer: { schemaId: string } };

      expect(generator.DEFAULT_OUTPUT).toBe(SCHEMA_FILE);
      expect(generator.DEFAULT_SCHEMA_ID).toBe(defaultConfig.configServer.schemaId);
    });

    it('should exit with an error and usage, writing nothing, on invalid arguments', () => {
      withTempDir((dir) => {
        const result = spawnSync(process.execPath, [GENERATOR, '--output', '--schema-id', 'x'], { cwd: dir, encoding: 'utf8' });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('missing value for --output');
        expect(result.stderr).toContain('usage: node scripts/generateConfigServerSchema.js');
        expect(existsSync(path.join(dir, '--schema-id'))).toBe(false);
        expect(existsSync(path.join(dir, 'schemas'))).toBe(false);
      });
    });

    it('should resolve an explicit relative --output against the working directory and apply --schema-id', () => {
      withTempDir((dir) => {
        execFileSync(process.execPath, [GENERATOR, '--output=out/schema.json', '--schema-id', 'https://example.com/x'], { cwd: dir, stdio: 'pipe' });

        const generated = readFileSync(path.join(dir, 'out', 'schema.json'), 'utf8');

        expect(generated).toBe(readFileSync(SCHEMA_FILE, 'utf8').replace(`"$id": "${SCHEMA_ID}"`, '"$id": "https://example.com/x"'));
      });
    });
  });

  describe('schema id', () => {
    it('should be the schemaId basemap-management sends to config-server, in config and in the Helm chart', () => {
      const defaultConfig = JSON.parse(readFileSync(path.join(ROOT, 'config', 'default.json'), 'utf8')) as { configServer: { schemaId: string } };
      const helmValues = load(readFileSync(path.join(ROOT, 'helm', 'values.yaml'), 'utf8')) as {
        basemapManagement: { configServer: { schemaId: string } };
      };

      expect(committedSchema.$id).toBe(SCHEMA_ID);
      expect(defaultConfig.configServer.schemaId).toBe(SCHEMA_ID);
      expect(helmValues.basemapManagement.configServer.schemaId).toBe(SCHEMA_ID);
    });

    it('should name the committed file like the schemas repository file (<version>.schema.json)', () => {
      const version = SCHEMA_ID.slice(SCHEMA_ID.lastIndexOf('/') + 1);

      expect(version).toBe('v1');
      expect(path.basename(SCHEMA_FILE)).toBe(`${version}.schema.json`);
    });
  });

  describe('additionalProperties', () => {
    const objects = collectObjectSchemas(committedSchema);

    it('should list every object schema as either closed or open', () => {
      expect([...objects.keys()].sort()).toEqual([...CLOSED_OBJECTS, ...OPEN_OBJECTS, ...MATCHER_OBJECTS].sort());
    });

    it.each(MATCHER_OBJECTS)('should leave the role matcher at "%s" without additionalProperties', (pointer) => {
      expect(objects.get(pointer)).not.toHaveProperty('additionalProperties');
    });

    it.each(CLOSED_OBJECTS)('should close the object at "%s" (additionalProperties: false)', (pointer) => {
      expect(objects.get(pointer)?.additionalProperties).toBe(false);
    });

    it.each(OPEN_OBJECTS)('should keep the .passthrough() object at "%s" open (additionalProperties: true)', (pointer) => {
      expect(objects.get(pointer)?.additionalProperties).toBe(true);
    });
  });

  describe("with config-server's validator", () => {
    it('should compile in strict mode with the same Ajv (draft 2019-09) options', () => {
      expect(() => createConfigServerAjv().compile(committedSchema)).not.toThrow();
    });

    it.each(VALID_CONFIGS)('should accept %s, as Zod does', (_name, config) => {
      expect(StoredConfigSchema.safeParse(config).success).toBe(true);
      expect(jsonSchemaAccepts(config)).toBe(true);
    });

    it.each(INVALID_CONFIGS)('should reject %s, as Zod does', (_name, config) => {
      expect(StoredConfigSchema.safeParse(config).success).toBe(false);
      expect(jsonSchemaAccepts(config)).toBe(false);
    });

    it.each(UNKNOWN_KEY_CONFIGS)('should reject an unknown key on %s, which Zod strips (its output is accepted)', (_name, config) => {
      const parsed = StoredConfigSchema.safeParse(config);

      expect(parsed.success).toBe(true);
      expect(jsonSchemaAccepts(config)).toBe(false);
      expect(jsonSchemaAccepts(parsed.data)).toBe(true);
    });

    it('should compile without strict-mode warnings', () => {
      const warnings: unknown[] = [];
      const logger = {
        log: (): void => undefined,
        warn: (...args: unknown[]): number => warnings.push(args),
        error: (...args: unknown[]): number => warnings.push(args),
      };
      const ajv = addFormats(new Ajv2019({ keywords: ['x-env-value', 'x-env-format'], discriminator: true, useDefaults: true, logger }));

      ajv.compile(committedSchema);

      expect(warnings).toEqual([]);
    });

    it.each(ROLE_CONFIGS)(
      'should enforce at most one isCurrent / isForPreview: %s (accepted: %s), as basemap-management does',
      (_name, config, accepted) => {
        expect(StoredConfigSchema.safeParse(config).success).toBe(true);
        expect(jsonSchemaAccepts(config)).toBe(accepted);
        expect(findCollectionConflicts(config.basemaps).length === 0).toBe(accepted);
      }
    );

    it.each(BMM_ONLY_INVARIANTS)('should accept %s, which only basemap-management rejects', (_name, config) => {
      expect(StoredConfigSchema.safeParse(config).success).toBe(true);
      expect(jsonSchemaAccepts(config)).toBe(true);
      expect(bmmConflicts(config)).not.toEqual([]);
    });

    it.each(KNOWN_GAPS)('should accept %s, which only basemap-management rejects (Zod refinement)', (_name, config) => {
      expect(StoredConfigSchema.safeParse(config).success).toBe(false);
      expect(jsonSchemaAccepts(config)).toBe(true);
    });

    it('should not add defaults to a stored config', () => {
      const config = { basemaps: structuredClone(MOCK_PERSISTED_BASEMAPS) };
      const before = JSON.stringify(config);

      expect(validateWithConfigServerAjv(config)).toBe(true);
      expect(JSON.stringify(config)).toBe(before);
    });
  });
});
