import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBasemapManagementEnv } from '@src/common/env';

const ENV_KEYS = [
  'CONFIG_MANAGEMENT_URL',
  'CONFIG_BASEMAPS_NAME',
  'CONFIG_BASEMAPS_SCHEMA_ID',
  'RASTER_CATALOG_URL',
  'MAP_SERVER_URL',
  'IMPORT_PACKAGE_MAX_SIZE_BYTES',
  'BASEMAP_MOCK_DATA',
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

  it('falls back to sensible defaults when nothing is set', () => {
    const env = getBasemapManagementEnv();

    expect(env.configServer.configName).toBe('basemaps');
    expect(env.uploadLimits.importPackageMaxSizeBytes).toBeGreaterThan(0);
  });

  it('reads every value from process.env when set', () => {
    process.env.CONFIG_MANAGEMENT_URL = 'http://config-server';
    process.env.CONFIG_BASEMAPS_NAME = 'basemaps-test';
    process.env.CONFIG_BASEMAPS_SCHEMA_ID = 'https://example.com/schema';
    process.env.RASTER_CATALOG_URL = 'http://raster-catalog';
    process.env.MAP_SERVER_URL = 'http://mapproxy';
    process.env.IMPORT_PACKAGE_MAX_SIZE_BYTES = '456';
    process.env.BASEMAP_MOCK_DATA = 'true';

    const env = getBasemapManagementEnv();

    expect(env).toEqual({
      configServer: { url: 'http://config-server', configName: 'basemaps-test', schemaId: 'https://example.com/schema' },
      rasterCatalog: { url: 'http://raster-catalog' },
      mapServer: { url: 'http://mapproxy' },
      uploadLimits: { importPackageMaxSizeBytes: 456 },
      mockData: true,
    });
  });

  it('throws for a non-numeric size-limit value', () => {
    process.env.IMPORT_PACKAGE_MAX_SIZE_BYTES = 'not-a-number';

    expect(() => getBasemapManagementEnv()).toThrow(/invalid byte-size/);
  });

  describe('BASEMAP_MOCK_DATA', () => {
    it('is disabled when unset', () => {
      expect(getBasemapManagementEnv().mockData).toBe(false);
    });

    it('is disabled when explicitly "false"', () => {
      process.env.BASEMAP_MOCK_DATA = 'false';

      expect(getBasemapManagementEnv().mockData).toBe(false);
    });

    it('is enabled only by an explicit "true"', () => {
      process.env.BASEMAP_MOCK_DATA = 'true';

      expect(getBasemapManagementEnv().mockData).toBe(true);
    });

    it.each(['', 'TRUE', '1', 'yes', ' true'])('fails startup for the malformed value %j instead of guessing', (value) => {
      process.env.BASEMAP_MOCK_DATA = value;

      expect(() => getBasemapManagementEnv()).toThrow(/invalid BASEMAP_MOCK_DATA/);
    });
  });
});
