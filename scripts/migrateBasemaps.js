#!/usr/bin/env node
/**
 * Migrates basemaps from the old `{ maps: [...] }` format to the PersistedBasemap[] format
 * consumed by config-server.
 *
 * Usage:
 *   node scripts/migrateBasemaps.js --input <oldFormat.json> --output <migrated.json> [--resolve-wmts-as-external[=true|false]]
 *
 * --resolve-wmts-as-external (optional, default: false; can also be set via the RESOLVE_WMTS_AS_EXTERNAL env var)
 *   - true:  WMTS layers are migrated the same way as XYZ layers (source.type = EXTERNAL).
 *   - false: WMTS layers are migrated as CATALOG_RESOURCE sources, with productId/productType
 *            parsed out of the WMTS url's `{productId}-{productType}` path segment (the one
 *            immediately before the `{TileMatrixSet}` template token). When that segment can't
 *            be found/parsed, productId/productType are left null so the basemap shows up as an
 *            unresolved catalog layer for manual fixup in the UI, instead of failing migration.
 *
 * A basemap whose baseRasterLayers is empty (or missing) is omitted from the output entirely and
 * logged (with its id and title) instead of being migrated as a basemap with zero layers.
 *
 * baseRasterLayers[N].type may carry a `_LAYER` suffix (e.g. `XYZ_LAYER`) in the old format; it's
 * stripped before the WMTS check and before being used as the migrated layer's protocol.
 */

const fs = require('node:fs');
const path = require('node:path');
const { SourceType, PersistedBasemapSchema } = require('@map-colonies/app-shared');
const { Domain, OGC_ImageryProtocolType, PROPRIETARY_ImageryProtocolType } = require('@map-colonies/types');

const PROTOCOLS = new Set([...Object.values(OGC_ImageryProtocolType), ...Object.values(PROPRIETARY_ImageryProtocolType)]);
const TILE_MATRIX_SET_TOKEN = '{TileMatrixSet}';
const LAYER_TYPE_SUFFIX = '_LAYER';

/** The old format's baseRasterLayers[N].type may be suffixed with `_LAYER` (e.g. `XYZ_LAYER`); strip it. */
function normalizeLayerType(type) {
  return type.endsWith(LAYER_TYPE_SUFFIX) ? type.slice(0, -LAYER_TYPE_SUFFIX.length) : type;
}

function parseArgs(argv) {
  const args = { input: undefined, output: undefined, resolveWmtsAsExternal: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '-i') {
      args.input = argv[(i += 1)];
    } else if (arg.startsWith('--input=')) {
      args.input = arg.slice('--input='.length);
    } else if (arg === '--output' || arg === '-o') {
      args.output = argv[(i += 1)];
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
    } else if (arg === '--resolve-wmts-as-external') {
      const next = argv[i + 1];
      if (next === 'true' || next === 'false') {
        args.resolveWmtsAsExternal = next === 'true';
        i += 1;
      } else {
        args.resolveWmtsAsExternal = true;
      }
    } else if (arg.startsWith('--resolve-wmts-as-external=')) {
      args.resolveWmtsAsExternal = arg.slice('--resolve-wmts-as-external='.length).toLowerCase() === 'true';
    }
  }
  return args;
}

function parseBooleanEnv(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  return value.trim().toLowerCase() === 'true';
}

/**
 * Pulls `{productId}-{productType}` out of the path segment that precedes the `{TileMatrixSet}`
 * template token, e.g. `.../wmts/CYPRUS_LOW_RES-Orthophoto/{TileMatrixSet}/...` -> CYPRUS_LOW_RES / Orthophoto.
 */
function parseProductFromWmtsUrl(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split('?')[0];
  }
  // `new URL(...)` percent-encodes the literal `{`/`}` template braces, so decode each segment before matching.
  const segments = pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
  const tokenIndex = segments.indexOf(TILE_MATRIX_SET_TOKEN);
  const candidate = tokenIndex > 0 ? segments[tokenIndex - 1] : undefined;
  if (candidate === undefined) {
    return { productId: null, productType: null };
  }

  const splitIndex = candidate.lastIndexOf('-');
  if (splitIndex <= 0) {
    return { productId: candidate, productType: null };
  }
  return { productId: candidate.slice(0, splitIndex), productType: candidate.slice(splitIndex + 1) };
}

function migrateLayerAsExternal(oldLayer, protocol, warnings) {
  if (!PROTOCOLS.has(protocol)) {
    warnings.push(`layer "${oldLayer.id}" has unrecognized protocol "${protocol}"`);
  }
  const { url, ...restOptions } = oldLayer.options ?? {};
  return {
    id: oldLayer.id,
    order: oldLayer.zIndex,
    opacity: oldLayer.opacity,
    shouldBeUsedInModelDraping: oldLayer.shouldBeUsedInModelDraping,
    source: {
      type: SourceType.EXTERNAL,
      details: { protocol, name: oldLayer.id, url, ...restOptions },
    },
  };
}

function migrateLayer(oldLayer, { resolveWmtsAsExternal }, warnings) {
  const layerType = normalizeLayerType(oldLayer.type);
  if (layerType === 'WMTS' && !resolveWmtsAsExternal) {
    const { productId, productType } = parseProductFromWmtsUrl(oldLayer.options?.url ?? '');
    if (productId === null || productType === null) {
      warnings.push(`layer "${oldLayer.id}" has a WMTS url that could not be parsed into productId/productType - left unresolved`);
    }
    return {
      id: oldLayer.id,
      order: oldLayer.zIndex,
      opacity: oldLayer.opacity,
      shouldBeUsedInModelDraping: oldLayer.shouldBeUsedInModelDraping,
      source: {
        type: SourceType.CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness: { productId, productType },
      },
    };
  }

  return migrateLayerAsExternal(oldLayer, layerType, warnings);
}

function migrateBasemap(oldBasemap, options, warnings) {
  return {
    id: oldBasemap.id,
    name: oldBasemap.title,
    isCurrent: oldBasemap.isCurrent ?? false,
    isForPreview: false,
    thumbnail: { url: oldBasemap.thumbnail, width: 128, height: 128 },
    layers: (oldBasemap.baseRasterLayers ?? []).map((layer) => migrateLayer(layer, options, warnings)),
  };
}

/** Mirrors `applyDefaultRoles`: only the last basemap with isCurrent=true keeps it. */
function dedupeCurrentOwner(basemaps, warnings) {
  const currentOwners = basemaps.filter((basemap) => basemap.isCurrent);
  if (currentOwners.length > 1) {
    warnings.push(`${currentOwners.length} basemaps had isCurrent=true (${currentOwners.map((b) => b.id).join(', ')}) - keeping only the last one`);
  }
  const lastCurrentId = currentOwners.at(-1)?.id;
  return basemaps.map((basemap) => (basemap.isCurrent && basemap.id !== lastCurrentId ? { ...basemap, isCurrent: false } : basemap));
}

function main() {
  const { input, output, resolveWmtsAsExternal: resolveWmtsAsExternalArg } = parseArgs(process.argv.slice(2));
  if (!input || !output) {
    console.error(
      'Usage: node scripts/migrateBasemaps.js --input <oldFormat.json> --output <migrated.json> [--resolve-wmts-as-external[=true|false]]'
    );
    process.exitCode = 1;
    return;
  }

  const resolveWmtsAsExternal = resolveWmtsAsExternalArg ?? parseBooleanEnv(process.env.RESOLVE_WMTS_AS_EXTERNAL, false);
  const oldDocument = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  const oldBasemaps = oldDocument.maps ?? [];

  const warnings = [];
  const emptyBasemaps = oldBasemaps.filter((oldBasemap) => (oldBasemap.baseRasterLayers ?? []).length === 0);
  const migratableBasemaps = oldBasemaps.filter((oldBasemap) => (oldBasemap.baseRasterLayers ?? []).length > 0);

  let migrated = migratableBasemaps.map((oldBasemap) => migrateBasemap(oldBasemap, { resolveWmtsAsExternal }, warnings));
  migrated = dedupeCurrentOwner(migrated, warnings);

  const valid = [];
  const failed = [];
  for (const basemap of migrated) {
    const result = PersistedBasemapSchema.safeParse(basemap);
    if (result.success) {
      valid.push(result.data);
    } else {
      failed.push({ id: basemap.id, name: basemap.name, issues: result.error.issues });
    }
  }

  fs.writeFileSync(path.resolve(output), JSON.stringify({ basemaps: valid }, null, 2));

  for (const oldBasemap of emptyBasemaps) {
    console.warn(`warning: basemap "${oldBasemap.title}" (${oldBasemap.id}) has no baseRasterLayers - omitted from output`);
  }
  for (const warning of warnings) {
    console.warn(`warning: ${warning}`);
  }
  for (const failure of failed) {
    console.error(`error: basemap "${failure.name}" (${failure.id}) failed schema validation and was dropped from the output:`);
    for (const issue of failure.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
  }
  console.log(
    `migrated ${valid.length}/${oldBasemaps.length} basemaps (${emptyBasemaps.length} omitted for having no baseRasterLayers, resolveWmtsAsExternal=${resolveWmtsAsExternal}) -> ${output}`
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
