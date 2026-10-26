import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBasemapManagementEnv } from '@src/common/env';

const ENV_KEYS = [
  'CONFIG_MANAGEMENT_URL',
  'CONFIG_BASEMAPS_NAME',
  'CONFIG_BASEMAPS_SCHEMA_ID',
  'DATA_SERVICE_URL',
  'RASTER_CATALOG_URL',
  'RASTER_CATALOG_MODE',
  'MAP_SERVER_URL',
  'THUMBNAIL_MAX_SIZE_BYTES',
  'IMPORT_PACKAGE_MAX_SIZE_BYTES',
] as const;

describe('getBasemapManagementEnv', () => {
  const originalValues: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalValues[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalValues[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValues[key];
      }
    }
  });

  it('falls back to sensible defaults, including RASTER_CATALOG_MODE=stub, when nothing is set', () => {
    const env = getBasemapManagementEnv();

    expect(env.configServer.configName).toBe('basemaps');
    expect(env.rasterCatalog.mode).toBe('stub');
    expect(env.dataService.url).toBe('');
    expect(env.uploadLimits.thumbnailMaxSizeBytes).toBeGreaterThan(0);
  });

  it('reads every value from process.env when set', () => {
    process.env.CONFIG_MANAGEMENT_URL = 'http://config-server';
    process.env.CONFIG_BASEMAPS_NAME = 'basemaps-test';
    process.env.CONFIG_BASEMAPS_SCHEMA_ID = 'https://example.com/schema';
    process.env.DATA_SERVICE_URL = 'http://data-service';
    process.env.RASTER_CATALOG_URL = 'http://raster-catalog';
    process.env.RASTER_CATALOG_MODE = 'stub';
    process.env.MAP_SERVER_URL = 'http://mapproxy';
    process.env.THUMBNAIL_MAX_SIZE_BYTES = '123';
    process.env.IMPORT_PACKAGE_MAX_SIZE_BYTES = '456';

    const env = getBasemapManagementEnv();

    expect(env).toEqual({
      configServer: { url: 'http://config-server', configName: 'basemaps-test', schemaId: 'https://example.com/schema' },
      dataService: { url: 'http://data-service' },
      rasterCatalog: { url: 'http://raster-catalog', mode: 'stub' },
      mapServer: { url: 'http://mapproxy' },
      uploadLimits: { thumbnailMaxSizeBytes: 123, importPackageMaxSizeBytes: 456 },
    });
  });

  it('throws for an unrecognized RASTER_CATALOG_MODE rather than silently ignoring it', () => {
    process.env.RASTER_CATALOG_MODE = 'not-a-real-mode';

    expect(() => getBasemapManagementEnv()).toThrow(/RASTER_CATALOG_MODE/);
  });

  it('throws for a non-numeric size-limit value', () => {
    process.env.THUMBNAIL_MAX_SIZE_BYTES = 'not-a-number';

    expect(() => getBasemapManagementEnv()).toThrow(/invalid byte-size/);
  });
});
