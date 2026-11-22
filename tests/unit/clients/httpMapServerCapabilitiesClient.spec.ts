import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { describe, afterAll, beforeAll, beforeEach, it, expect, vi } from 'vitest';
import { HttpMapServerCapabilitiesClient } from '@src/clients/mapServer/httpMapServerCapabilitiesClient';
import type { IBasemapManagementEnv } from '@src/common/env';

const TOKEN = 'test-secret-token';

function envWith(
  url: string,
  options: Partial<IBasemapManagementEnv['accessToken']> & { exposureType?: IBasemapManagementEnv['mapServer']['exposureType'] } = {}
): IBasemapManagementEnv {
  const { exposureType = 'ROUTE', ...accessToken } = options;
  return {
    configServer: { url: '', configName: 'basemaps', schemaId: 's' },
    rasterCatalog: { url: '', exposureType: 'SERVICE' },
    mapServer: { url, exposureType },
    accessToken: { attributeName: 'token', injectionType: 'queryParam', tokenValue: '', ...accessToken },
    uploadLimits: { importPackageMaxSizeBytes: 1 },
    mockData: false,
  };
}

const logDir = mkdtempSync(path.join(tmpdir(), 'bmm-mapserver-logs-'));
let logFileIndex = 0;

async function capturingLogger(): Promise<{ logger: Logger; output: () => string }> {
  const file = path.join(logDir, `log-${logFileIndex++}.jsonl`);
  const logger = await jsLogger({ level: 'trace' }, file);
  return { logger, output: () => (existsSync(file) ? readFileSync(file, 'utf8') : '') };
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
    rmSync(logDir, { recursive: true, force: true });
  });

  it.each([
    ['', '/wmts/1.0.0/WMTSCapabilities.xml'],
    ['/', '/wmts/1.0.0/WMTSCapabilities.xml'],
    ['/wmts/1.0.0/WMTSCapabilities.xml', '/wmts/1.0.0/WMTSCapabilities.xml'],
    ['/api/raster/v1', '/api/raster/v1/wmts/1.0.0/WMTSCapabilities.xml'],
  ])('appends the WMTS capabilities path to %s only when missing', async (urlSuffix, expectedPath) => {
    const client = new HttpMapServerCapabilitiesClient(envWith(`${baseUrl}${urlSuffix}`), await jsLogger({ enabled: false }));

    const capabilities = await client.getCapabilities();

    expect(requestedPaths).toEqual([expectedPath]);
    expect(capabilities.map((capability) => capability.id)).toEqual(['a']);
  });

  describe('access token (same rules as catalog-web-app-bff urlHandler)', () => {
    it('adds the token as a query parameter for a ROUTE with queryParam injection', async () => {
      const client = new HttpMapServerCapabilitiesClient(
        envWith(`${baseUrl}/api/raster/v1`, { tokenValue: TOKEN }),
        await jsLogger({ enabled: false })
      );

      await client.getCapabilities();

      expect(requestedPaths).toEqual([`/api/raster/v1/wmts/1.0.0/WMTSCapabilities.xml?token=${TOKEN}`]);
    });

    it('uses the configured attribute name and keeps an existing query string', async () => {
      const client = new HttpMapServerCapabilitiesClient(
        envWith(`${baseUrl}/api/raster/v1?foo=bar`, { tokenValue: TOKEN, attributeName: 'access', injectionType: 'QUERYPARAM' }),
        await jsLogger({ enabled: false })
      );

      await client.getCapabilities();

      expect(requestedPaths).toEqual([`/api/raster/v1/wmts/1.0.0/WMTSCapabilities.xml?foo=bar&access=${TOKEN}`]);
    });

    it.each([
      ['a SERVICE exposure', { exposureType: 'SERVICE' as const, tokenValue: TOKEN }],
      ['header injection', { injectionType: 'header', tokenValue: TOKEN }],
      ['an empty token', { tokenValue: '' }],
    ])('sends no token for %s', async (_case, options) => {
      const client = new HttpMapServerCapabilitiesClient(envWith(baseUrl, options), await jsLogger({ enabled: false }));

      await client.getCapabilities();

      expect(requestedPaths).toEqual(['/wmts/1.0.0/WMTSCapabilities.xml']);
    });

    it.each([
      [503, 'Internal Server Error'],
      [401, 'unauthorized'],
    ])('never exposes the token in the thrown error or the logs when MapProxy answers %d', async (status, expectedLog) => {
      responseStatus = status;
      const { logger, output } = await capturingLogger();
      const client = new HttpMapServerCapabilitiesClient(envWith(baseUrl, { tokenValue: TOKEN }), logger);

      const error = (await client.getCapabilities().catch((err: unknown) => err)) as Error;

      expect(error).toBeInstanceOf(Error);
      expect(`${error.message}\n${error.stack}\n${JSON.stringify(error)}`).not.toContain(TOKEN);
      expect(requestedPaths).toEqual([`/wmts/1.0.0/WMTSCapabilities.xml?token=${TOKEN}`]);

      await vi.waitFor(() => expect(output()).toContain(expectedLog));

      expect(output()).not.toContain(TOKEN);
    });

    it('never exposes the token in the logs when MapProxy is unreachable', async () => {
      const { logger, output } = await capturingLogger();
      const client = new HttpMapServerCapabilitiesClient(envWith('http://127.0.0.1:1', { tokenValue: TOKEN }), logger);

      await expect(client.getCapabilities()).rejects.toMatchObject({ status: 500 });

      await vi.waitFor(() => expect(output()).toContain('Internal Server Error'));
      expect(output()).not.toContain(TOKEN);
    });
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

  it('keeps failing (not throwing at construction) when no URL is configured', async () => {
    const client = new HttpMapServerCapabilitiesClient(envWith(''), await jsLogger({ enabled: false }));

    await expect(client.getCapabilities()).rejects.toBeDefined();
  });
});
