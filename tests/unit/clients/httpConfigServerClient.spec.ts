/* eslint-disable @typescript-eslint/require-await -- every mock below stands in for the global `fetch`; none has real async work to await */
import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { HttpConfigServerClient } from '@src/clients/configServer/httpConfigServerClient';
import type { IBasemapManagementEnv } from '@src/common/env';

const TEST_ENV: IBasemapManagementEnv = {
  configServer: { url: 'http://config-server', configName: 'basemaps', schemaId: 'https://mapcolonies.com/basemaps/v1' },
  dataService: { url: '' },
  rasterCatalog: { url: '', mode: 'stub' },
  mapServer: { url: '' },
  uploadLimits: { thumbnailMaxSizeBytes: 1, importPackageMaxSizeBytes: 1 },
};

describe('HttpConfigServerClient', () => {
  let client: HttpConfigServerClient;

  beforeEach(async () => {
    client = new HttpConfigServerClient(TEST_ENV, await jsLogger({ enabled: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('#getLatest', () => {
    it('composes the URL from the origin-only base + /api/config, with the confirmed query params', async () => {
      const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ configs: [] }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await client.getLatest();

      const [requestInput] = fetchMock.mock.calls[0] ?? [];
      const requestedUrl = new URL((requestInput as URL).toString());
      expect(requestedUrl.origin + requestedUrl.pathname).toBe('http://config-server/api/config');
      expect(requestedUrl.searchParams.get('config_name')).toBe('basemaps');
      expect(requestedUrl.searchParams.get('schema_id')).toBe('https://mapcolonies.com/basemaps/v1');
      expect(requestedUrl.searchParams.get('version')).toBe('latest');
    });

    it('parses the confirmed { configs: [...] } envelope and finds the matching configName', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () => new Response(JSON.stringify({ configs: [{ configName: 'basemaps', config: { basemaps: [] }, version: 3 }] }), { status: 200 })
        )
      );

      const result = await client.getLatest();

      expect(result).toEqual({ document: { basemaps: [] }, version: 3 });
    });

    it('ignores configs entries for a different configName', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ configs: [{ configName: 'something-else', config: { basemaps: [{ id: 'x' }] } }] }), { status: 200 })
        )
      );

      const result = await client.getLatest();

      expect(result).toEqual({ document: { basemaps: [] }, version: undefined });
    });

    it('leaves version undefined when the matching entry has no version field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ configs: [{ configName: 'basemaps', config: { basemaps: [] } }] }), { status: 200 }))
      );

      const result = await client.getLatest();

      expect(result).toEqual({ document: { basemaps: [] }, version: undefined });
    });

    it('returns an empty list with version undefined when no document exists yet (404)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 404 }))
      );

      const result = await client.getLatest();

      expect(result).toEqual({ document: { basemaps: [] }, version: undefined });
    });

    it('throws UpstreamServiceError on a non-ok, non-404 status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 500 }))
      );

      await expect(client.getLatest()).rejects.toMatchObject({ statusCode: 502 });
    });

    it('throws UpstreamServiceError when the network request itself fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))
      );

      await expect(client.getLatest()).rejects.toMatchObject({ statusCode: 502 });
    });

    it('throws UpstreamServiceError when the response body has no "configs" array', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ notConfigs: [] }), { status: 200 }))
      );

      await expect(client.getLatest()).rejects.toMatchObject({ statusCode: 502 });
    });
  });

  describe('#save', () => {
    it('posts to the origin-only base + /api/config with the confirmed body shape', async () => {
      const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(null, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await client.save({ basemaps: [] }, 2);

      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe('http://config-server/api/config');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        configName: 'basemaps',
        schemaId: 'https://mapcolonies.com/basemaps/v1',
        version: 3,
        config: { basemaps: [] },
      });
    });

    it('resolves with the next version on a successful write', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 200 }))
      );

      const result = await client.save({ basemaps: [] }, 2);

      expect(result).toEqual({ version: 3 });
    });

    it('starts at version 1 when there is no previous version', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 200 }))
      );

      const result = await client.save({ basemaps: [] }, undefined);

      expect(result).toEqual({ version: 1 });
    });

    it('throws UpstreamServiceError on a non-ok status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 409 }))
      );

      await expect(client.save({ basemaps: [] }, 1)).rejects.toMatchObject({ statusCode: 502 });
    });

    it('throws UpstreamServiceError when the network request itself fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))
      );

      await expect(client.save({ basemaps: [] }, 1)).rejects.toMatchObject({ statusCode: 502 });
    });
  });
});
