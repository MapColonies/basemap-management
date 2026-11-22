/* eslint-disable @typescript-eslint/require-await -- every mock below stands in for the global `fetch` */
import { jsLogger } from '@map-colonies/js-logger';
import { describe, afterEach, it, expect, vi } from 'vitest';
import { Domain, ProductType } from '@map-colonies/types';
import { HttpRasterCatalogClient } from '@src/clients/rasterCatalog/httpRasterCatalogClient';
import type { IBasemapManagementEnv } from '@src/common/env';

function envWith(url: string): IBasemapManagementEnv {
  return {
    configServer: { url: '', configName: 'basemaps', schemaId: 's' },
    rasterCatalog: { url, exposureType: 'SERVICE' },
    mapServer: { url: '', exposureType: 'SERVICE' },
    accessToken: { attributeName: 'token', injectionType: 'queryParam', tokenValue: '' },
    uploadLimits: { importPackageMaxSizeBytes: 1 },
    mockData: false,
  };
}

const UNIQUENESS = { productId: '12345', productType: ProductType.ORTHOPHOTO };

function searchResultsXml(records: string): string {
  return `<csw:GetRecordsResponse xmlns:csw="http://www.opengis.net/cat/csw/2.0.2" xmlns:mc="http://schema.mapcolonies.com/raster">
  <csw:SearchResults numberOfRecordsMatched="1" numberOfRecordsReturned="1">${records}</csw:SearchResults>
</csw:GetRecordsResponse>`;
}

function rasterRecordXml(opts: { id?: string; productVersion?: string; withLinks?: boolean }): string {
  const { id = 'record-1', productVersion = '1.0', withLinks = true } = opts;
  return `<mc:MCRasterRecord>
    ${id.length > 0 ? `<mc:id>${id}</mc:id>` : ''}
    <mc:productId>12345</mc:productId>
    <mc:productVersion>${productVersion}</mc:productVersion>
    <mc:productType>Orthophoto</mc:productType>
    ${withLinks ? '<mc:links scheme="WMTS" name="12345-Orthophoto" description="wmts link">https://mapproxy/wmts</mc:links>' : ''}
  </mc:MCRasterRecord>`;
}

function stubFetch(responseXml: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(responseXml, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('HttpRasterCatalogClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a matching raster catalog record, mapped to LayerRasterRecord', async () => {
    stubFetch(searchResultsXml(rasterRecordXml({})));
    const client = new HttpRasterCatalogClient(envWith('http://pycsw'), await jsLogger({ enabled: false }));

    const layer = await client.resolveLayer(Domain.RASTER, UNIQUENESS);

    expect(layer).toMatchObject({
      id: 'record-1',
      productId: '12345',
      productVersion: '1.0',
      productType: 'Orthophoto',
      links: [{ protocol: 'WMTS', name: '12345-Orthophoto', url: 'https://mapproxy/wmts' }],
    });
  });

  it('queries PyCSW by productId and productType', async () => {
    const fetchMock = stubFetch(searchResultsXml(rasterRecordXml({})));
    const client = new HttpRasterCatalogClient(envWith('http://pycsw'), await jsLogger({ enabled: false }));

    await client.resolveLayer(Domain.RASTER, UNIQUENESS);

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(requestInit.method).toBe('POST');
    expect(String(requestInit.body)).toContain('12345');
    expect(String(requestInit.body)).toContain('Orthophoto');
  });

  it('resolves null when no record matches', async () => {
    stubFetch(searchResultsXml(''));
    const client = new HttpRasterCatalogClient(envWith('http://pycsw'), await jsLogger({ enabled: false }));

    await expect(client.resolveLayer(Domain.RASTER, UNIQUENESS)).resolves.toBeNull();
  });

  it('selects the highest productVersion when multiple records match', async () => {
    stubFetch(searchResultsXml(rasterRecordXml({ id: 'v1', productVersion: '1.0' }) + rasterRecordXml({ id: 'v2', productVersion: '2.0' })));
    const client = new HttpRasterCatalogClient(envWith('http://pycsw'), await jsLogger({ enabled: false }));

    const layer = await client.resolveLayer(Domain.RASTER, UNIQUENESS);

    expect(layer).toMatchObject({ id: 'v2', productVersion: '2.0' });
  });

  it('resolves null for a record missing required fields (no links)', async () => {
    stubFetch(searchResultsXml(rasterRecordXml({ withLinks: false })));
    const client = new HttpRasterCatalogClient(envWith('http://pycsw'), await jsLogger({ enabled: false }));

    await expect(client.resolveLayer(Domain.RASTER, UNIQUENESS)).resolves.toBeNull();
  });

  it('resolves null for a record missing its id', async () => {
    stubFetch(searchResultsXml(rasterRecordXml({ id: '' })));
    const client = new HttpRasterCatalogClient(envWith('http://pycsw'), await jsLogger({ enabled: false }));

    await expect(client.resolveLayer(Domain.RASTER, UNIQUENESS)).resolves.toBeNull();
  });

  it('throws UpstreamServiceError on a non-ok PyCSW response', async () => {
    stubFetch('', 503);
    const client = new HttpRasterCatalogClient(envWith('http://pycsw'), await jsLogger({ enabled: false }));

    await expect(client.resolveLayer(Domain.RASTER, UNIQUENESS)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws UpstreamServiceError when the request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))
    );
    const client = new HttpRasterCatalogClient(envWith('http://pycsw'), await jsLogger({ enabled: false }));

    await expect(client.resolveLayer(Domain.RASTER, UNIQUENESS)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws UpstreamServiceError on an unexpected (non-CSW) response body', async () => {
    stubFetch('<not-a-csw-response/>');
    const client = new HttpRasterCatalogClient(envWith('http://pycsw'), await jsLogger({ enabled: false }));

    await expect(client.resolveLayer(Domain.RASTER, UNIQUENESS)).rejects.toMatchObject({ statusCode: 502 });
  });
  describe('access token (same rules as catalog-web-app-bff requestHandlerWithToken)', () => {
    const TOKEN = 'pycsw-secret-token';

    function envWithToken(
      injectionType: string,
      exposureType: IBasemapManagementEnv['rasterCatalog']['exposureType'] = 'ROUTE',
      url = 'http://pycsw/api/raster/v1'
    ): IBasemapManagementEnv {
      const env = envWith(url);
      return { ...env, rasterCatalog: { url, exposureType }, accessToken: { attributeName: 'token', injectionType, tokenValue: TOKEN } };
    }

    it('adds the token as a query parameter for a ROUTE with queryParam injection', async () => {
      const fetchMock = stubFetch(searchResultsXml(rasterRecordXml({})));
      const client = new HttpRasterCatalogClient(envWithToken('queryParam'), await jsLogger({ enabled: false }));

      await client.resolveLayer(Domain.RASTER, UNIQUENESS);

      const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`http://pycsw/api/raster/v1?token=${TOKEN}`);
      expect(JSON.stringify(requestInit.headers ?? {})).not.toContain(TOKEN);
    });

    it('adds the token as a header for a ROUTE with header injection', async () => {
      const fetchMock = stubFetch(searchResultsXml(rasterRecordXml({})));
      const client = new HttpRasterCatalogClient(envWithToken('header'), await jsLogger({ enabled: false }));

      await client.resolveLayer(Domain.RASTER, UNIQUENESS);

      const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toBe('http://pycsw/api/raster/v1');
      expect(requestInit.headers).toMatchObject({ token: TOKEN });
    });

    it('sends no token to a SERVICE-exposed catalog', async () => {
      const fetchMock = stubFetch(searchResultsXml(rasterRecordXml({})));
      const client = new HttpRasterCatalogClient(envWithToken('queryParam', 'SERVICE'), await jsLogger({ enabled: false }));

      await client.resolveLayer(Domain.RASTER, UNIQUENESS);

      const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toBe('http://pycsw/api/raster/v1');
      expect(JSON.stringify(requestInit.headers ?? {})).not.toContain(TOKEN);
    });

    it('never exposes the token in the thrown error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          throw new TypeError(`fetch failed for ${url}`);
        })
      );
      const client = new HttpRasterCatalogClient(envWithToken('queryParam'), await jsLogger({ enabled: false }));

      const error = (await client.resolveLayer(Domain.RASTER, UNIQUENESS).catch((err: unknown) => err)) as Error;

      expect(error.message).toMatch(/Raster PyCSW request failed/);
      expect(error.message).not.toContain(TOKEN);
    });
  });
});
