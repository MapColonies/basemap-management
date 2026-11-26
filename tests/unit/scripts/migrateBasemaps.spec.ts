/* eslint-disable @typescript-eslint/naming-convention */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PersistedBasemap } from '@map-colonies/app-shared';

const SCRIPT = path.join(process.cwd(), 'scripts', 'migrateBasemaps.js');
const INPUT = 'input.json';
const OUTPUT = 'migrated.json';
const THUMBNAIL = 'https://thumbnails.example.com/thumb.png';
const WMTS_URL = 'https://raster.example.com/wmts/PRODUCT_A-Orthophoto/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png';

type OldLayer = Record<string, unknown>;
type Layer = PersistedBasemap['layers'][number];

interface IRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  basemaps?: PersistedBasemap[];
}

let tempRoot: string;

function oldLayer(overrides: OldLayer): OldLayer {
  return { id: 'layer', type: 'XYZ_LAYER', opacity: 1, zIndex: 0, options: { url: 'https://tiles.example.com/{z}/{x}/{y}.png' }, ...overrides };
}

function oldBasemap(id: string, layers: unknown[]): Record<string, unknown> {
  return { id, title: `Title ${id}`, thumbnail: THUMBNAIL, baseRasterLayers: layers };
}

function run(maps: unknown, args: string[] = [], env: Record<string, string> = {}, document: unknown = { maps }): IRunResult {
  const cwd = mkdtempSync(path.join(tempRoot, 'run-'));
  writeFileSync(path.join(cwd, INPUT), JSON.stringify(document));
  const result = spawnSync(process.execPath, [SCRIPT, '-i', INPUT, '-o', OUTPUT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
  const outputFile = path.join(cwd, OUTPUT);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    basemaps: existsSync(outputFile) ? (JSON.parse(readFileSync(outputFile, 'utf8')) as { basemaps: PersistedBasemap[] }).basemaps : undefined,
  };
}

function onlyLayer(result: IRunResult): Layer | undefined {
  return result.basemaps?.[0]?.layers[0];
}

const WMTS_OPTIONS = { url: WMTS_URL, layer: 'PRODUCT_A-Orthophoto', style: 'default', format: 'image/png', tileMatrixSetID: 'WorldCRS84' };
const WMTS_MAPS = [oldBasemap('bm-wmts', [oldLayer({ id: 'wmts', type: 'WMTS_LAYER', options: WMTS_OPTIONS })])];

describe('scripts/migrateBasemaps.js', () => {
  beforeAll(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'bmm-migrate-'));
  });

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('external layer options', () => {
    it('should keep WMTS options under details.extras when resolving WMTS as external', () => {
      const result = run(WMTS_MAPS, ['--resolve-wmts-as-external']);

      expect(result.status).toBe(0);
      expect(onlyLayer(result)?.source).toEqual({
        type: 'EXTERNAL',
        details: {
          protocol: 'WMTS',
          name: 'wmts',
          url: WMTS_URL,
          extras: { layer: 'PRODUCT_A-Orthophoto', style: 'default', format: 'image/png', tileMatrixSetID: 'WorldCRS84' },
        },
      });
    });

    it('should keep XYZ options under details.extras', () => {
      const result = run([oldBasemap('bm-xyz', [oldLayer({ options: { url: 'https://tiles.example.com/{z}/{x}/{y}.png', maximumLevel: 18 } })])]);

      expect(onlyLayer(result)?.source).toEqual({
        type: 'EXTERNAL',
        details: { protocol: 'XYZ', name: 'layer', url: 'https://tiles.example.com/{z}/{x}/{y}.png', extras: { maximumLevel: 18 } },
      });
    });

    it('should keep nested option values as-is', () => {
      const options = { url: 'https://tiles.example.com/{z}/{x}/{y}.png', credit: { text: '© provider' }, subdomains: ['a', 'b'] };

      const result = run([oldBasemap('bm-nested', [oldLayer({ options })])]);

      expect(onlyLayer(result)?.source).toMatchObject({ details: { extras: { credit: { text: '© provider' }, subdomains: ['a', 'b'] } } });
    });

    it('should omit details.extras when url is the only option', () => {
      const result = run([oldBasemap('bm-url-only', [oldLayer({})])]);

      expect(onlyLayer(result)?.source).toEqual({
        type: 'EXTERNAL',
        details: { protocol: 'XYZ', name: 'layer', url: 'https://tiles.example.com/{z}/{x}/{y}.png' },
      });
    });

    it('should not let options named like detail fields override protocol or name', () => {
      const options = { url: 'https://tiles.example.com/{z}/{x}/{y}.png', protocol: 'WMS', name: 'provider-name' };

      const result = run([oldBasemap('bm-collision', [oldLayer({ options })])]);

      expect(onlyLayer(result)?.source).toMatchObject({
        details: { protocol: 'XYZ', name: 'layer', extras: { protocol: 'WMS', name: 'provider-name' } },
      });
    });

    it('should still migrate WMTS layers as CATALOG_RESOURCE without their options by default', () => {
      const result = run(WMTS_MAPS);

      expect(onlyLayer(result)?.source).toEqual({
        type: 'CATALOG_RESOURCE',
        domain: 'RASTER',
        uniqueness: { productId: 'PRODUCT_A', productType: 'Orthophoto' },
      });
    });
  });

  describe('--resolve-wmts-as-external and RESOLVE_WMTS_AS_EXTERNAL', () => {
    it.each([
      { name: 'flag alone', args: ['--resolve-wmts-as-external'], expected: true },
      { name: 'flag followed by another option', args: ['--resolve-wmts-as-external', '--output', OUTPUT], expected: true },
      { name: 'separate true', args: ['--resolve-wmts-as-external', 'true'], expected: true },
      { name: 'separate TRUE', args: ['--resolve-wmts-as-external', 'TRUE'], expected: true },
      { name: 'separate false', args: ['--resolve-wmts-as-external', 'false'], expected: false },
      { name: 'separate False', args: ['--resolve-wmts-as-external', 'False'], expected: false },
      { name: 'separate FALSE', args: ['--resolve-wmts-as-external', 'FALSE'], expected: false },
      { name: '=True', args: ['--resolve-wmts-as-external=True'], expected: true },
      { name: '=fAlSe', args: ['--resolve-wmts-as-external=fAlSe'], expected: false },
      { name: 'env True', args: [], env: { RESOLVE_WMTS_AS_EXTERNAL: 'True' }, expected: true },
      { name: 'env " false "', args: [], env: { RESOLVE_WMTS_AS_EXTERNAL: ' false ' }, expected: false },
      { name: 'env blank (default)', args: [], env: { RESOLVE_WMTS_AS_EXTERNAL: '  ' }, expected: false },
      { name: 'no flag, no env (default)', args: [], expected: false },
      { name: 'CLI False over env true', args: ['--resolve-wmts-as-external', 'False'], env: { RESOLVE_WMTS_AS_EXTERNAL: 'true' }, expected: false },
      { name: 'CLI over an invalid env value', args: ['--resolve-wmts-as-external=true'], env: { RESOLVE_WMTS_AS_EXTERNAL: 'yes' }, expected: true },
    ])('should parse $name as $expected', ({ args, env, expected }) => {
      const result = run(WMTS_MAPS, args, env);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`resolveWmtsAsExternal=${String(expected)}`);
      expect(onlyLayer(result)?.source.type).toBe(expected ? 'EXTERNAL' : 'CATALOG_RESOURCE');
    });

    it.each([
      { name: 'separate value', args: ['--resolve-wmts-as-external', 'yes'], source: '--resolve-wmts-as-external', value: 'yes' },
      { name: '= value', args: ['--resolve-wmts-as-external=1'], source: '--resolve-wmts-as-external', value: '1' },
      { name: 'empty = value', args: ['--resolve-wmts-as-external='], source: '--resolve-wmts-as-external', value: '' },
      {
        name: 'env value',
        args: [],
        env: { RESOLVE_WMTS_AS_EXTERNAL: 'on' },
        source: 'the RESOLVE_WMTS_AS_EXTERNAL environment variable',
        value: 'on',
      },
    ])('should reject an invalid $name with a usage error and write nothing', ({ args, env, source, value }) => {
      const result = run(WMTS_MAPS, args, env);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        `error: ${source} must be "true" or "false" (case-insensitive), got "${value}"\n` +
          'Usage: node scripts/migrateBasemaps.js --input <oldFormat.json> --output <migrated.json> [--resolve-wmts-as-external[=true|false]]\n'
      );
      expect(result.stdout).toBe('');
      expect(result.basemaps).toBeUndefined();
    });
  });

  describe('layers without a usable type', () => {
    it.each([
      { name: 'missing', type: undefined, description: 'no type' },
      { name: 'null', type: null, description: 'an invalid type null' },
      { name: 'a number', type: 5, description: 'an invalid type 5' },
      { name: 'empty', type: '', description: 'an invalid type ""' },
      { name: 'blank', type: '  ', description: 'an invalid type "  "' },
      { name: 'only the _LAYER suffix', type: '_LAYER', description: 'an invalid type "_LAYER"' },
    ])('should warn about a $name type and drop only the affected basemap', ({ type, description }) => {
      const broken = oldLayer({ id: 'typeless', zIndex: 1 });
      if (type === undefined) {
        delete broken.type;
      } else {
        broken.type = type;
      }
      const maps = [oldBasemap('bm-broken', [oldLayer({ id: 'fine' }), broken]), oldBasemap('bm-ok', [oldLayer({ id: 'other' })])];

      const result = run(maps);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `warning: layer "typeless" (basemap "Title bm-broken" (bm-broken), baseRasterLayers[1]) has ${description} - migrated without a protocol, so its basemap fails schema validation\n`
      );
      expect(result.stderr).toContain('error: basemap "Title bm-broken" (bm-broken) failed schema validation and was dropped from the output:\n');
      expect(result.stderr).toContain('  - layers.1.source.details.protocol: ');
      expect(result.stderr).not.toContain('unrecognized protocol');
      expect(result.basemaps?.map((basemap) => basemap.id)).toEqual(['bm-ok']);
      expect(result.stdout).toContain('migrated 1/2 basemaps');
    });

    it('should keep warning about unrecognized but present types', () => {
      const result = run([oldBasemap('bm-mystery', [oldLayer({ id: 'mystery', type: 'MYSTERY_LAYER' })])]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('warning: layer "mystery" has unrecognized protocol "MYSTERY"\n');
    });
  });

  describe('malformed legacy entries', () => {
    it.each([
      { name: 'null', entry: null, description: 'null' },
      { name: 'a string', entry: 'layer', description: 'a string ("layer")' },
      { name: 'a number', entry: 7, description: 'a number (7)' },
      { name: 'a boolean', entry: true, description: 'a boolean (true)' },
      { name: 'an array', entry: [oldLayer({ id: 'nested' })], description: 'an array' },
    ])('should warn about and skip a layer entry that is $name, migrating the rest', ({ entry, description }) => {
      const maps = [oldBasemap('bm-mixed', [oldLayer({ id: 'first' }), entry, oldLayer({ id: 'last', zIndex: 2 })])];

      const result = run(maps);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe(
        `warning: basemap "Title bm-mixed" (bm-mixed), baseRasterLayers[1] is ${description}, not a layer object - skipped\n`
      );
      expect(result.basemaps?.[0]?.layers.map((layer) => layer.id)).toEqual(['first', 'last']);
      expect(result.stdout).toContain('migrated 1/1 basemaps');
    });

    it('should omit a basemap whose layer entries are all malformed', () => {
      const maps = [oldBasemap('bm-all-bad', [null, 3]), oldBasemap('bm-ok', [oldLayer({})])];

      const result = run(maps);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(
        'warning: basemap "Title bm-all-bad" (bm-all-bad), baseRasterLayers[0] is null, not a layer object - skipped\n'
      );
      expect(result.stderr).toContain(
        'warning: basemap "Title bm-all-bad" (bm-all-bad), baseRasterLayers[1] is a number (3), not a layer object - skipped\n'
      );
      expect(result.stderr).toContain('warning: basemap "Title bm-all-bad" (bm-all-bad) has no baseRasterLayers - omitted from output\n');
      expect(result.basemaps?.map((basemap) => basemap.id)).toEqual(['bm-ok']);
      expect(result.stdout).toContain('migrated 1/2 basemaps (1 omitted for having no baseRasterLayers');
    });

    it.each([
      { name: 'an object', layers: { 0: oldLayer({}) }, description: 'an object' },
      { name: 'a string', layers: 'layers', description: 'a string ("layers")' },
    ])('should treat baseRasterLayers that are $name as empty', ({ layers }) => {
      const maps = [{ ...oldBasemap('bm-weird', []), baseRasterLayers: layers }, oldBasemap('bm-ok', [oldLayer({})])];

      const result = run(maps);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(`warning: basemap "Title bm-weird" (bm-weird) has baseRasterLayers that are `);
      expect(result.stderr).toContain('not an array - treated as empty\n');
      expect(result.stderr).toContain('warning: basemap "Title bm-weird" (bm-weird) has no baseRasterLayers - omitted from output\n');
      expect(result.basemaps?.map((basemap) => basemap.id)).toEqual(['bm-ok']);
    });

    it.each([
      { name: 'null', entry: null, description: 'null' },
      { name: 'a string', entry: 'bm', description: 'a string ("bm")' },
      { name: 'an array', entry: [], description: 'an array' },
    ])('should warn about and skip a maps entry that is $name', ({ entry, description }) => {
      const result = run([entry, oldBasemap('bm-ok', [oldLayer({})])]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe(`warning: maps[0] is ${description}, not a basemap object - skipped\n`);
      expect(result.basemaps?.map((basemap) => basemap.id)).toEqual(['bm-ok']);
      expect(result.stdout).toContain('migrated 1/2 basemaps');
    });

    it.each([
      { name: 'null', document: null },
      { name: 'an array', document: [] },
      { name: 'a string', document: 'maps' },
      { name: 'an object with non-array maps', document: { maps: { id: 'bm' } } },
    ])('should reject an input document that is $name and write nothing', ({ document }) => {
      const result = run(undefined, [], {}, document);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe(`error: ${INPUT} must contain a JSON object with a "maps" array\n`);
      expect(result.stdout).toBe('');
      expect(result.basemaps).toBeUndefined();
    });

    it.each([
      {
        name: 'a string',
        options: 'https://tiles.example.com/{z}/{x}/{y}.png',
        description: 'a string ("https://tiles.example.com/{z}/{x}/{y}.png")',
      },
      { name: 'an array', options: ['a'], description: 'an array' },
    ])('should ignore layer options that are $name instead of spreading them into extras', ({ options, description }) => {
      const result = run([oldBasemap('bm-bad-options', [oldLayer({ id: 'bad-options', options })])]);

      expect(result.stderr).toContain(
        `warning: layer "bad-options" (basemap "Title bm-bad-options" (bm-bad-options), baseRasterLayers[0]) has options that are ${description}, not an object - ignored\n`
      );
      expect(result.stderr).not.toContain('extras');
      expect(result.basemaps).toEqual([]);
      expect(result.status).toBe(1);
    });

    it.each([
      { name: 'a non-string url', url: 42 },
      { name: 'a url with malformed percent-encoding', url: 'https://raster.example.com/wmts/%E0%A4%A/{TileMatrixSet}/x.png' },
    ])('should leave a WMTS layer with $name unresolved instead of crashing', ({ url }) => {
      const result = run([oldBasemap('bm-wmts-bad-url', [oldLayer({ id: 'wmts', type: 'WMTS_LAYER', options: { url } })])]);

      expect(result.stderr).not.toContain('TypeError');
      expect(result.stderr).not.toContain('URIError');
      expect(result.stdout).toContain('migrated');
    });
  });
});
