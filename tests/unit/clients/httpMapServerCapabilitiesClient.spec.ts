import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, afterAll, beforeAll, beforeEach, it, expect } from 'vitest';
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

const XML = `<Capabilities><Contents>
  <Layer>
    <ows:Identifier>a</ows:Identifier>
    <Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>
    <Format>image/png</Format>
    <TileMatrixSetLink><TileMatrixSet>webmercator</TileMatrixSet></TileMatrixSetLink>
    <ResourceURL format="image/png" resourceType="tile" template="https://mapproxy/wmts/a/{TileMatrix}.png"/>
  </Layer>
  <TileMatrixSet>
    <ows:Identifier>webmercator</ows:Identifier>
    <TileMatrix><ows:Identifier>0</ows:Identifier></TileMatrix>
  </TileMatrixSet>
</Contents></Capabilities>`;

describe('HttpMapServerCapabilitiesClient', () => {
  let server: http.Server;
  let baseUrl: string;
  let requestedPaths: string[];
  let responseStatus: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requestedPaths.push(req.url ?? '');
      res.writeHead(responseStatus, { 'Content-Type': 'text/xml' });
      res.end(responseStatus === 200 ? XML : '');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    requestedPaths = [];
    responseStatus = 200;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([
    ['', '/wmts/1.0.0/WMTSCapabilities.xml'],
    ['/', '/wmts/1.0.0/WMTSCapabilities.xml'],
    ['/wmts/1.0.0/WMTSCapabilities.xml', '/wmts/1.0.0/WMTSCapabilities.xml'],
  ])('appends the WMTS capabilities path to %s only when missing', async (urlSuffix, expectedPath) => {
    const client = new HttpMapServerCapabilitiesClient(envWith(`${baseUrl}${urlSuffix}`), await jsLogger({ enabled: false }));

    const capabilities = await client.getCapabilities();

    expect(requestedPaths).toEqual([expectedPath]);
    expect(capabilities.map((capability) => capability.id)).toEqual(['a']);
  });

  it('throws on a non-ok response', async () => {
    responseStatus = 503;
    const client = new HttpMapServerCapabilitiesClient(envWith(baseUrl), await jsLogger({ enabled: false }));

    await expect(client.getCapabilities()).rejects.toMatchObject({ status: 500 });
  });

  it('throws when the request itself fails', async () => {
    const client = new HttpMapServerCapabilitiesClient(envWith('http://127.0.0.1:1'), await jsLogger({ enabled: false }));

    await expect(client.getCapabilities()).rejects.toMatchObject({ status: 500 });
  });
});
