import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBasemapManagementEnv } from '@src/common/env';
import { getConfig, initConfig } from '@src/common/config';

const SECRET = 'super-secret-token-value';
const ENV_KEYS = [
  'NODE_CONFIG_DIR',
  'CONFIG_MANAGEMENT_URL',
  'CONFIG_BASEMAPS_NAME',
  'CONFIG_BASEMAPS_SCHEMA_ID',
  'RASTER_CATALOG_URL',
  'MAP_SERVER_URL',
  'ACCESS_TOKEN_ATTRIBUTE_NAME',
  'ACCESS_TOKEN_INJECTION_TYPE',
  'ACCESS_TOKEN_TOKEN_VALUE',
  'IMPORT_PACKAGE_MAX_SIZE_BYTES',
  'BASEMAP_MOCK_DATA',
] as const;

function validConfig(): Record<string, unknown> {
  return {
    configServer: { url: 'http://config-server', configName: 'basemaps', schemaId: 'https://example.com/schema' },
    rasterCatalog: { url: 'http://raster-catalog', exposureType: 'ROUTE' },
    mapServer: { url: 'http://mapproxy', exposureType: 'ROUTE' },
    accessToken: { attributeName: 'token', injectionType: 'queryParam', tokenValue: SECRET },
    uploadLimits: { importPackageMaxSizeBytes: 456 },
  };
}

function fromConfig(config: Record<string, unknown>): ReturnType<typeof getBasemapManagementEnv> {
  return getBasemapManagementEnv({ getAll: () => config as never });
}

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

  describe('validation', () => {
    it('returns the validated config values', () => {
      expect(fromConfig(validConfig())).toEqual({ ...validConfig(), mockData: false });
    });

    it('coerces a numeric size-limit string (env vars are strings)', () => {
      const config = { ...validConfig(), uploadLimits: { importPackageMaxSizeBytes: '789' } };

      expect(fromConfig(config).uploadLimits.importPackageMaxSizeBytes).toBe(789);
    });

    it.each([
      ['a non-numeric size limit', { uploadLimits: { importPackageMaxSizeBytes: 'not-a-number' } }, /uploadLimits\.importPackageMaxSizeBytes/],
      ['an unknown exposure type', { mapServer: { url: 'http://mapproxy', exposureType: 'PUBLIC' } }, /mapServer\.exposureType/],
      [
        'an unknown token injection type',
        { accessToken: { attributeName: 'token', injectionType: 'cookie', tokenValue: SECRET } },
        /accessToken\.injectionType: must be "header" or "queryParam"/,
      ],
      ['a missing mapServer section', { mapServer: undefined }, /mapServer: Required/],
    ])('fails with a clear error for %s, without echoing the token', (_case, override, expectedMessage) => {
      const error = (() => {
        try {
          fromConfig({ ...validConfig(), ...override });
        } catch (err) {
          return err as Error;
        }
        throw new Error('expected getBasemapManagementEnv to throw');
      })();

      expect(error.message).toMatch(/^invalid basemap-management configuration - /);
      expect(error.message).toMatch(expectedMessage);
      expect(error.message).not.toContain(SECRET);
    });
  });

  describe('loading through @map-colonies/config (config files + env overrides)', () => {
    let configDir: string;

    beforeEach(() => {
      configDir = mkdtempSync(path.join(tmpdir(), 'bmm-config-'));
      cpSync(path.resolve('config'), configDir, { recursive: true });
      writeFileSync(
        path.join(configDir, 'local-test.json'),
        JSON.stringify({ mapServer: { url: 'http://mapproxy-from-file/api/raster/v1' }, accessToken: { tokenValue: SECRET } })
      );
      process.env.NODE_CONFIG_DIR = configDir;
    });

    afterEach(() => {
      rmSync(configDir, { recursive: true, force: true });
    });

    it('reads values from the config files', async () => {
      await initConfig(true);

      const env = getBasemapManagementEnv(getConfig());

      expect(env.mapServer).toEqual({ url: 'http://mapproxy-from-file/api/raster/v1', exposureType: 'ROUTE' });
      expect(env.accessToken).toEqual({ attributeName: 'token', injectionType: 'queryParam', tokenValue: SECRET });
      expect(env.configServer).toEqual({ url: 'http://localhost:8080', configName: 'basemaps', schemaId: 'https://mapcolonies.com/basemaps/v1' });
      expect(env.uploadLimits.importPackageMaxSizeBytes).toBe(10485760);
    });

    it('lets environment variables override the config files', async () => {
      process.env.CONFIG_MANAGEMENT_URL = 'http://config-server';
      process.env.CONFIG_BASEMAPS_NAME = 'basemaps-test';
      process.env.CONFIG_BASEMAPS_SCHEMA_ID = 'https://example.com/schema';
      process.env.RASTER_CATALOG_URL = 'http://raster-catalog';
      process.env.MAP_SERVER_URL = 'http://mapproxy-from-env';
      process.env.ACCESS_TOKEN_ATTRIBUTE_NAME = 'access';
      process.env.ACCESS_TOKEN_INJECTION_TYPE = 'header';
      process.env.ACCESS_TOKEN_TOKEN_VALUE = 'token-from-env';
      process.env.IMPORT_PACKAGE_MAX_SIZE_BYTES = '456';
      await initConfig(true);

      expect(getBasemapManagementEnv(getConfig())).toEqual({
        configServer: { url: 'http://config-server', configName: 'basemaps-test', schemaId: 'https://example.com/schema' },
        rasterCatalog: { url: 'http://raster-catalog', exposureType: 'ROUTE' },
        mapServer: { url: 'http://mapproxy-from-env', exposureType: 'ROUTE' },
        accessToken: { attributeName: 'access', injectionType: 'header', tokenValue: 'token-from-env' },
        uploadLimits: { importPackageMaxSizeBytes: 456 },
        mockData: false,
      });
    });

    it('ignores an empty environment variable (node-config semantics), keeping the file value', async () => {
      process.env.MAP_SERVER_URL = '';
      await initConfig(true);

      expect(getBasemapManagementEnv(getConfig()).mapServer.url).toBe('http://mapproxy-from-file/api/raster/v1');
    });

    it('does not read BASEMAP_MOCK_DATA from the config files', async () => {
      writeFileSync(path.join(configDir, 'local-test.json'), JSON.stringify({ mockData: true }));
      await initConfig(true);

      expect(getBasemapManagementEnv(getConfig()).mockData).toBe(false);
    });
  });

  describe('BASEMAP_MOCK_DATA (raw environment variable)', () => {
    it('is disabled when unset', () => {
      expect(fromConfig(validConfig()).mockData).toBe(false);
    });

    it('is disabled when explicitly "false"', () => {
      process.env.BASEMAP_MOCK_DATA = 'false';

      expect(fromConfig(validConfig()).mockData).toBe(false);
    });

    it('is enabled only by an explicit "true"', () => {
      process.env.BASEMAP_MOCK_DATA = 'true';

      expect(fromConfig(validConfig()).mockData).toBe(true);
    });

    it.each(['', 'TRUE', '1', 'yes', ' true'])('fails startup for the malformed value %j instead of guessing', (value) => {
      process.env.BASEMAP_MOCK_DATA = value;

      expect(() => fromConfig(validConfig())).toThrow(/invalid BASEMAP_MOCK_DATA/);
    });
  });
});
