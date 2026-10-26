/* eslint-disable @typescript-eslint/require-await -- every mock below stands in for the global `fetch` */
import { jsLogger } from '@map-colonies/js-logger';
import { describe, afterEach, it, expect, vi } from 'vitest';
import { HttpMapServerCapabilitiesClient } from '@src/clients/mapServer/httpMapServerCapabilitiesClient';
import type { IBasemapManagementEnv } from '@src/common/env';

function envWith(url: string): IBasemapManagementEnv {
  return {
    configServer: { url: '', configName: 'basemaps', schemaId: 's' },
    dataService: { url: '' },
    rasterCatalog: { url: '', mode: 'stub' },
    mapServer: { url },
    uploadLimits: { thumbnailMaxSizeBytes: 1, importPackageMaxSizeBytes: 1 },
  };
}

const XML = `<Capabilities><Contents><Layer><ows:Identifier>a</ows:Identifier><Format>image/png</Format></Layer></Contents></Capabilities>`;

describe('HttpMapServerCapabilitiesClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['http://mapproxy', 'http://mapproxy/wmts/1.0.0/WMTSCapabilities.xml'],
    ['http://mapproxy/', 'http://mapproxy/wmts/1.0.0/WMTSCapabilities.xml'],
    ['http://mapproxy/wmts/1.0.0/WMTSCapabilities.xml', 'http://mapproxy/wmts/1.0.0/WMTSCapabilities.xml'],
  ])('appends the WMTS capabilities path to %s only when missing', async (url, expectedUrl) => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(XML, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpMapServerCapabilitiesClient(envWith(url), await jsLogger({ enabled: false }));

    const capabilities = await client.getCapabilities();

    expect(fetchMock).toHaveBeenCalledWith(expectedUrl);
    expect(capabilities.map((capability) => capability.id)).toEqual(['a']);
  });

  it('throws UpstreamServiceError on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const client = new HttpMapServerCapabilitiesClient(envWith('http://mapproxy'), await jsLogger({ enabled: false }));

    await expect(client.getCapabilities()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws UpstreamServiceError when the request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))
    );
    const client = new HttpMapServerCapabilitiesClient(envWith('http://mapproxy'), await jsLogger({ enabled: false }));

    await expect(client.getCapabilities()).rejects.toMatchObject({ statusCode: 502 });
  });
});
