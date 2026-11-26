/* eslint-disable @typescript-eslint/naming-convention */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PersistedBasemap } from '@map-colonies/app-shared';

const ROOT = process.cwd();
const SOURCE_SCRIPT = path.join(ROOT, 'scripts', 'migrateBasemaps.js');
const BUILDER = path.join(ROOT, 'scripts', 'buildMigrationBundle.js');
const FIXTURE = path.join(ROOT, 'tests', 'unit', 'scripts', 'fixtures', 'oldFormatBasemaps.json');
const BUNDLE_NAME = 'migrateBasemaps.js';
const INPUT = 'input.json';
const OUTPUT = 'migrated.json';
const BUILD_TIMEOUT_MS = 60_000;

interface IBuilder {
  assertStandalone: (code: string) => void;
  OMITTED_MODULES: { id: string }[];
}
const builder = createRequire(path.join(ROOT, 'package.json'))(BUILDER) as IBuilder;

interface IRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  output?: string;
}

let tempRoot: string;
let bundleDir: string;
let bundlePath: string;

/** Runs `script` with a minimal environment: no NODE_PATH/NODE_OPTIONS, nothing but PATH and `env`. */
function run(script: string, args: string[], env: Record<string, string> = {}, input: string = FIXTURE): IRunResult {
  const cwd = mkdtempSync(path.join(tempRoot, 'run-'));
  copyFileSync(input, path.join(cwd, INPUT));
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
  const outputFile = path.join(cwd, OUTPUT);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : undefined,
  };
}

function runBoth(args: string[], env?: Record<string, string>, input?: string): { source: IRunResult; bundle: IRunResult } {
  return { source: run(SOURCE_SCRIPT, args, env, input), bundle: run(bundlePath, args, env, input) };
}

function parseOutput(result: IRunResult): PersistedBasemap[] {
  return (JSON.parse(result.output ?? 'null') as { basemaps: PersistedBasemap[] }).basemaps;
}

function findLayer(basemaps: PersistedBasemap[], layerId: string): PersistedBasemap['layers'][number] | undefined {
  return basemaps.flatMap((basemap) => basemap.layers).find((layer) => layer.id === layerId);
}

describe('standalone migration bundle', () => {
  beforeAll(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'bmm-migration-bundle-'));
    const buildDir = mkdtempSync(path.join(tempRoot, 'build-'));
    execFileSync(process.execPath, [BUILDER, '--output', path.join(buildDir, BUNDLE_NAME)], { cwd: ROOT, stdio: 'pipe' });
    // Only the bundle itself is copied into the directory it runs from.
    bundleDir = mkdtempSync(path.join(tempRoot, 'standalone-'));
    bundlePath = path.join(bundleDir, BUNDLE_NAME);
    copyFileSync(path.join(buildDir, BUNDLE_NAME), bundlePath);
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('isolation', () => {
    it('should run from a directory with no node_modules anywhere on the module resolution path', () => {
      const ancestors: string[] = [];
      for (let dir = bundleDir; ; dir = path.dirname(dir)) {
        ancestors.push(dir);
        if (path.dirname(dir) === dir) {
          break;
        }
      }

      expect(ancestors.filter((dir) => existsSync(path.join(dir, 'node_modules')))).toEqual([]);
      expect(path.relative(ROOT, bundleDir).startsWith('..')).toBe(true);
    });

    it('should require only Node.js built-in modules', () => {
      const code = readFileSync(bundlePath, 'utf8');

      expect(() => builder.assertStandalone(code)).not.toThrow();
      expect(code).not.toContain(ROOT);
    });

    it('should reject a bundle that still requires an npm package', () => {
      expect(() => builder.assertStandalone('require("node:fs"); require("zod");')).toThrow('require("zod")');
      expect(() => builder.assertStandalone('require(name);')).toThrow('dynamic require');
    });

    it('should list the bundled packages and the omitted modules in its banner', () => {
      const code = readFileSync(bundlePath, 'utf8');

      expect(code.startsWith('#!/usr/bin/env node\n')).toBe(true);
      expect(code).toMatch(/@map-colonies\/app-shared@\S+ \(/);
      expect(code).toMatch(/@map-colonies\/types@\S+ \(/);
      expect(code).toMatch(/zod@\S+ \(MIT\)/);

      for (const omitted of builder.OMITTED_MODULES) {
        expect(code).toContain(omitted.id);
      }
    });

    it('should be reproducible: rebuilding produces a byte-identical bundle', () => {
      const rebuilt = path.join(mkdtempSync(path.join(tempRoot, 'rebuild-')), BUNDLE_NAME);
      execFileSync(process.execPath, [BUILDER, `--output=${rebuilt}`], { cwd: ROOT, stdio: 'pipe' });

      expect(readFileSync(rebuilt, 'utf8')).toBe(readFileSync(bundlePath, 'utf8'));
    });
  });

  describe('behaves exactly like scripts/migrateBasemaps.js', () => {
    it.each([
      { name: 'default (WMTS -> CATALOG_RESOURCE)', args: ['--input', INPUT, '--output', OUTPUT] },
      { name: 'short options', args: ['-i', INPUT, '-o', OUTPUT] },
      { name: '--resolve-wmts-as-external flag', args: [`--input=${INPUT}`, `--output=${OUTPUT}`, '--resolve-wmts-as-external'] },
      { name: '--resolve-wmts-as-external true', args: ['-i', INPUT, '-o', OUTPUT, '--resolve-wmts-as-external', 'true'] },
      { name: '--resolve-wmts-as-external false', args: ['-i', INPUT, '-o', OUTPUT, '--resolve-wmts-as-external', 'false'] },
      { name: '--resolve-wmts-as-external=TRUE', args: ['-i', INPUT, '-o', OUTPUT, '--resolve-wmts-as-external=TRUE'] },
      { name: 'RESOLVE_WMTS_AS_EXTERNAL=true', args: ['-i', INPUT, '-o', OUTPUT], env: { RESOLVE_WMTS_AS_EXTERNAL: 'true' } },
      { name: 'RESOLVE_WMTS_AS_EXTERNAL=false', args: ['-i', INPUT, '-o', OUTPUT], env: { RESOLVE_WMTS_AS_EXTERNAL: 'false' } },
      {
        name: 'CLI false overrides RESOLVE_WMTS_AS_EXTERNAL=true',
        args: ['-i', INPUT, '-o', OUTPUT, '--resolve-wmts-as-external=false'],
        env: { RESOLVE_WMTS_AS_EXTERNAL: ' TRUE ' },
      },
      {
        name: 'CLI true overrides RESOLVE_WMTS_AS_EXTERNAL=false',
        args: ['-i', INPUT, '-o', OUTPUT, '--resolve-wmts-as-external'],
        env: { RESOLVE_WMTS_AS_EXTERNAL: 'false' },
      },
      { name: 'missing --output (usage error)', args: ['--input', INPUT] },
      { name: 'no arguments (usage error)', args: [] },
    ])('should give the same output file, stdout, stderr and exit code: $name', ({ args, env }) => {
      const { source, bundle } = runBoth(args, env);

      expect(bundle).toEqual(source);
    });

    it('should exit with 0 and no errors when every basemap migrates', () => {
      const allValid = path.join(tempRoot, 'all-valid.json');
      const { maps } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { maps: { id: string }[] };
      writeFileSync(allValid, JSON.stringify({ maps: maps.filter((map) => map.id === 'bm-wmts-and-xyz') }));

      const { source, bundle } = runBoth(['-i', INPUT, '-o', OUTPUT], undefined, allValid);

      expect(bundle).toEqual(source);
      expect(bundle.status).toBe(0);
      expect(bundle.stderr).toBe('');
    });

    it('should fail the same way on an unparsable input file', () => {
      const broken = path.join(tempRoot, 'broken.json');
      writeFileSync(broken, '{ "maps": [');

      const { source, bundle } = runBoth(['-i', INPUT, '-o', OUTPUT], undefined, broken);

      expect(bundle.status).toBe(source.status);
      expect(bundle.status).not.toBe(0);
      expect(bundle.stderr).toContain('SyntaxError');
      expect(bundle.output).toBeUndefined();
    });
  });

  describe('migration results', () => {
    it('should migrate WMTS layers as CATALOG_RESOURCE by default and XYZ layers as EXTERNAL', () => {
      const result = run(bundlePath, ['-i', INPUT, '-o', OUTPUT]);
      const basemaps = parseOutput(result);

      expect(findLayer(basemaps, 'wmts-orthophoto')?.source).toEqual({
        type: 'CATALOG_RESOURCE',
        domain: 'RASTER',
        uniqueness: { productId: 'CYPRUS_LOW_RES', productType: 'Orthophoto' },
      });
      expect(findLayer(basemaps, 'xyz-streets')?.source).toMatchObject({
        type: 'EXTERNAL',
        details: { protocol: 'XYZ', name: 'xyz-streets', url: 'https://tiles.example.com/streets/{z}/{x}/{y}.png', extras: { maximumLevel: 18 } },
      });
      expect(result.stdout).toContain('resolveWmtsAsExternal=false');
    });

    it('should migrate WMTS layers as EXTERNAL when resolving WMTS as external', () => {
      const basemaps = parseOutput(run(bundlePath, ['-i', INPUT, '-o', OUTPUT, '--resolve-wmts-as-external']));

      expect(findLayer(basemaps, 'wmts-orthophoto')?.source).toMatchObject({
        type: 'EXTERNAL',
        details: {
          protocol: 'WMTS',
          name: 'wmts-orthophoto',
          extras: { layer: 'CYPRUS_LOW_RES-Orthophoto', style: 'default', format: 'image/png', tileMatrixSetID: 'WorldCRS84' },
        },
      });
    });

    it('should leave unparsable WMTS urls unresolved with a warning', () => {
      const result = run(bundlePath, ['-i', INPUT, '-o', OUTPUT]);
      const basemaps = parseOutput(result);

      expect(findLayer(basemaps, 'wmts-no-token')?.source).toMatchObject({ uniqueness: { productId: null, productType: null } });
      expect(findLayer(basemaps, 'wmts-no-product-type')?.source).toMatchObject({ uniqueness: { productId: 'NO_DASH', productType: null } });
      expect(result.stderr).toContain(
        'warning: layer "wmts-no-token" has a WMTS url that could not be parsed into productId/productType - left unresolved'
      );
    });

    it('should omit empty basemaps, drop invalid ones with their validation issues, and exit with 1', () => {
      const result = run(bundlePath, ['-i', INPUT, '-o', OUTPUT]);
      const ids = parseOutput(result).map((basemap) => basemap.id);

      expect(ids).toEqual(['bm-wmts-and-xyz', 'bm-wmts-unresolved', 'bm-unknown-protocol']);
      expect(result.stderr).toContain('warning: basemap "Empty layers" (bm-empty) has no baseRasterLayers - omitted from output');
      expect(result.stderr).toContain('warning: basemap "Missing layers" (bm-missing-layers) has no baseRasterLayers - omitted from output');
      expect(result.stderr).toContain(
        'error: basemap "Invalid after migration" (bm-invalid) failed schema validation and was dropped from the output:'
      );
      expect(result.stderr).toContain('  - layers.0.opacity: ');
      expect(result.stdout).toBe(`migrated 3/6 basemaps (2 omitted for having no baseRasterLayers, resolveWmtsAsExternal=false) -> ${OUTPUT}\n`);
      expect(result.status).toBe(1);
    });
  });
});
