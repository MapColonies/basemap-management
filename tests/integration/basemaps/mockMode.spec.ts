import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import jsZip from 'jszip';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, afterEach, afterAll, it, expect, beforeAll } from 'vitest';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import request from 'supertest';
import type { Response as SuperagentResponse } from 'superagent';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { Application } from 'express';
import type { DependencyContainer } from 'tsyringe';
import { createBasemapSchema } from '@map-colonies/app-shared';
import { CapabilityWMTSSchema } from '@map-colonies/wmts-client';
import type { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { initConfig } from '@src/common/config';
import { Status, type Basemap, type BasemapLayerOutput } from '@src/basemaps/models/types';
import { LayerRasterRecordSchema } from '@src/basemaps/models/catalogTypes';
import { CONFIG_SERVER_CLIENT } from '@src/clients/configServer/configServerClient';
import { HttpConfigServerClient } from '@src/clients/configServer/httpConfigServerClient';
import { InMemoryConfigServerClient } from '@src/clients/configServer/inMemoryConfigServerClient';
import { RASTER_CATALOG_CLIENT } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { HttpRasterCatalogClient } from '@src/clients/rasterCatalog/httpRasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import { HttpMapServerCapabilitiesClient } from '@src/clients/mapServer/httpMapServerCapabilitiesClient';
import { MOCK_CATALOG_PRODUCT, MOCK_PERSISTED_BASEMAPS } from '@src/basemaps/mock/mockBasemaps';

const BASEMAP_RESPONSE_SCHEMA = createBasemapSchema(LayerRasterRecordSchema, CapabilityWMTSSchema);
const UNRESOLVED_LAYER_ID = 'layer-14-04';
const WMTS_CAPABILITIES_PATH = '/wmts/1.0.0/WMTSCapabilities.xml';
const MOCK_RECORD_ID = 'mock-catalog-record-id';
const MOCK_WMTS_LAYER_ID = `${MOCK_CATALOG_PRODUCT.productId}-${MOCK_CATALOG_PRODUCT.productType}`;
const TOKEN = 'mock-mode-test-token';

function cswResponseXml(requestBody: string): string {
  const matches = requestBody.includes(MOCK_CATALOG_PRODUCT.productId) && requestBody.includes(MOCK_CATALOG_PRODUCT.productType);
  const record = `<mc:MCRasterRecord>
    <mc:id>${MOCK_RECORD_ID}</mc:id>
    <mc:productId>${MOCK_CATALOG_PRODUCT.productId}</mc:productId>
    <mc:productVersion>1.0</mc:productVersion>
    <mc:productType>${MOCK_CATALOG_PRODUCT.productType}</mc:productType>
    <mc:links scheme="WMTS" name="${MOCK_WMTS_LAYER_ID}" description="">https://mapproxy.test/api/raster/v1/wmts</mc:links>
  </mc:MCRasterRecord>`;
  return `<csw:GetRecordsResponse xmlns:csw="http://www.opengis.net/cat/csw/2.0.2" xmlns:mc="http://schema.mapcolonies.com/raster">
  <csw:SearchResults numberOfRecordsMatched="${matches ? 1 : 0}" numberOfRecordsReturned="${matches ? 1 : 0}">${matches ? record : ''}</csw:SearchResults>
</csw:GetRecordsResponse>`;
}
const MOCK_TILE_TEMPLATE = `https://mapproxy.test/api/raster/v1/wmts/${MOCK_WMTS_LAYER_ID}/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.png`;
const WMTS_CAPABILITIES_XML = `<Capabilities><Contents>
  <Layer>
    <ows:Identifier>${MOCK_WMTS_LAYER_ID}</ows:Identifier>
    <Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>
    <Format>image/png</Format>
    <TileMatrixSetLink><TileMatrixSet>WorldCRS84</TileMatrixSet></TileMatrixSetLink>
    <ResourceURL format="image/png" resourceType="tile" template="${MOCK_TILE_TEMPLATE}"/>
  </Layer>
  <TileMatrixSet>
    <ows:Identifier>WorldCRS84</ows:Identifier>
    <TileMatrix><ows:Identifier>00</ows:Identifier></TileMatrix>
    <TileMatrix><ows:Identifier>01</ows:Identifier></TileMatrix>
  </TileMatrixSet>
</Contents></Capabilities>`;

function binaryParser(res: SuperagentResponse, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function startServer(handler: (req: http.IncomingMessage, body: string) => string): Promise<[http.Server, string]> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      res.writeHead(httpStatusCodes.OK, { 'Content-Type': 'text/xml' });
      res.end(handler(req, body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return [server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`];
}

async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function buildApp(mockData: string | undefined): Promise<[Application, DependencyContainer]> {
  if (mockData === undefined) {
    delete process.env.BASEMAP_MOCK_DATA;
  } else {
    process.env.BASEMAP_MOCK_DATA = mockData;
  }
  await initConfig(true);
  return getApp({
    override: [
      { token: SERVICES.LOGGER, provider: { useValue: await jsLogger({ enabled: false }) } },
      { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
    ],
    useChild: true,
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('BASEMAP_MOCK_DATA', () => {
  const originalValue = process.env.BASEMAP_MOCK_DATA;
  const originalEnv = Object.fromEntries(
    ['MAP_SERVER_URL', 'RASTER_CATALOG_URL', 'ACCESS_TOKEN_TOKEN_VALUE', 'ACCESS_TOKEN_INJECTION_TYPE'].map((name) => [name, process.env[name]])
  );
  let mapProxy: http.Server;
  let mapProxyUrl: string;
  let mapProxyRequests: string[];
  let pycsw: http.Server;
  let pycswUrl: string;
  let pycswRequests: { url: string; tokenHeader: string | undefined }[];

  beforeAll(async () => {
    await initConfig(true);
    [mapProxy, mapProxyUrl] = await startServer((req) => {
      mapProxyRequests.push(req.url ?? '');
      return WMTS_CAPABILITIES_XML;
    });
    [pycsw, pycswUrl] = await startServer((req, body) => {
      pycswRequests.push({ url: req.url ?? '', tokenHeader: req.headers.token as string | undefined });
      return cswResponseXml(body);
    });
  });

  beforeEach(() => {
    mapProxyRequests = [];
    pycswRequests = [];
    process.env.MAP_SERVER_URL = mapProxyUrl;
    process.env.RASTER_CATALOG_URL = pycswUrl;
  });

  afterEach(() => {
    restoreEnv('BASEMAP_MOCK_DATA', originalValue);
    for (const [name, value] of Object.entries(originalEnv)) {
      restoreEnv(name, value);
    }
  });

  afterAll(async () => {
    await Promise.all([stopServer(mapProxy), stopServer(pycsw)]);
  });

  describe('normal mode', () => {
    it.each([undefined, 'false'])('registers the real HTTP data-source clients when BASEMAP_MOCK_DATA=%s', async (value) => {
      const [, container] = await buildApp(value);

      expect(container.resolve(CONFIG_SERVER_CLIENT)).toBeInstanceOf(HttpConfigServerClient);
      expect(container.resolve(RASTER_CATALOG_CLIENT)).toBeInstanceOf(HttpRasterCatalogClient);
      expect(container.resolve(MAP_SERVER_CAPABILITIES_CLIENT)).toBeInstanceOf(HttpMapServerCapabilitiesClient);
    });

    it('refuses to start on a malformed value instead of silently picking a mode', async () => {
      await expect(buildApp('yes')).rejects.toThrow(/invalid BASEMAP_MOCK_DATA/);
    });
  });

  describe('mock mode', () => {
    let app: Application;
    let container: DependencyContainer;
    let requestSender: RequestSender<paths, operations>;

    beforeEach(async () => {
      [app, container] = await buildApp('true');
      requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
    });

    it('mocks only config-server, keeping the real Raster Catalog and MapProxy clients', () => {
      expect(container.resolve(CONFIG_SERVER_CLIENT)).toBeInstanceOf(InMemoryConfigServerClient);
      expect(container.resolve(RASTER_CATALOG_CLIENT)).toBeInstanceOf(HttpRasterCatalogClient);
      expect(container.resolve(MAP_SERVER_CAPABILITIES_CLIENT)).toBeInstanceOf(HttpMapServerCapabilitiesClient);
    });

    function catalogLayers(basemaps: Basemap[]): BasemapLayerOutput[] {
      return basemaps.flatMap((basemap) => basemap.layers).filter((layer) => layer.source.type === 'CATALOG_RESOURCE');
    }

    it('lists the fixture basemaps through the real resolution pipeline, conforming to the API spec and output schema', async () => {
      const response = await requestSender.listBasemaps();

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response).toSatisfyApiSpec();

      const basemaps = response.body as Basemap[];

      expect(basemaps.map((basemap) => basemap.id)).toEqual(MOCK_PERSISTED_BASEMAPS.map((basemap) => basemap.id));

      for (const basemap of basemaps) {
        expect(BASEMAP_RESPONSE_SCHEMA.safeParse(basemap).success).toBe(true);
      }

      const layers = catalogLayers(basemaps);
      const unresolved = layers.filter((layer) => layer.id === UNRESOLVED_LAYER_ID);
      const resolved = layers.filter((layer) => layer.id !== UNRESOLVED_LAYER_ID);

      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]?.source).toMatchObject({ status: Status.UNRESOLVED, layer: null, capabilities: null });
      expect(resolved.length).toBeGreaterThan(0);

      for (const layer of resolved) {
        expect(layer.source).toMatchObject({
          status: Status.RESOLVED,
          layer: { id: MOCK_RECORD_ID, productId: MOCK_CATALOG_PRODUCT.productId, productType: MOCK_CATALOG_PRODUCT.productType },
        });

        const { capabilities } = layer.source as { capabilities: unknown };

        expect(CapabilityWMTSSchema.safeParse(capabilities).success).toBe(true);
        expect(capabilities).toMatchObject({ id: MOCK_WMTS_LAYER_ID, url: [{ template: MOCK_TILE_TEMPLATE }] });
      }

      expect(pycswRequests.length).toBeGreaterThan(0);
      expect(mapProxyRequests).toEqual([WMTS_CAPABILITIES_PATH]);
    });

    it('sends the configured access token to PyCSW and MapProxy (queryParam), as in normal mode', async () => {
      process.env.ACCESS_TOKEN_TOKEN_VALUE = TOKEN;
      const [tokenApp] = await buildApp('true');
      const tokenSender = await createRequestSender<paths, operations>('openapi3.yaml', tokenApp);

      const response = await tokenSender.getBasemap({ pathParams: { basemapId: 'basemap-14' } });

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(mapProxyRequests).toEqual([`${WMTS_CAPABILITIES_PATH}?token=${TOKEN}`]);
      expect(pycswRequests.length).toBeGreaterThan(0);
      expect(pycswRequests.every((request) => request.url === `/?token=${TOKEN}`)).toBe(true);
      expect((response.body as Basemap).layers.map((layer) => layer.source.status)).toEqual([
        Status.RESOLVED,
        Status.RESOLVED,
        Status.RESOLVED,
        Status.UNRESOLVED,
      ]);
    });

    it('sends the PyCSW token as a header for header injection (MapProxy capabilities get none, as in the BFF)', async () => {
      process.env.ACCESS_TOKEN_TOKEN_VALUE = TOKEN;
      process.env.ACCESS_TOKEN_INJECTION_TYPE = 'header';
      const [tokenApp] = await buildApp('true');
      const tokenSender = await createRequestSender<paths, operations>('openapi3.yaml', tokenApp);

      await tokenSender.getBasemap({ pathParams: { basemapId: 'basemap-14' } });

      expect(pycswRequests.length).toBeGreaterThan(0);
      expect(pycswRequests.every((request) => request.url === '/' && request.tokenHeader === TOKEN)).toBe(true);
      expect(mapProxyRequests).toEqual([WMTS_CAPABILITIES_PATH]);
    });

    it('does not fall back to static records when PyCSW is unreachable - catalog layers come back UNRESOLVED', async () => {
      process.env.RASTER_CATALOG_URL = 'http://127.0.0.1:1';
      const [unreachableApp] = await buildApp('true');
      const unreachableSender = await createRequestSender<paths, operations>('openapi3.yaml', unreachableApp);

      const response = await unreachableSender.listBasemaps();

      expect(response.status).toBe(httpStatusCodes.OK);

      for (const layer of catalogLayers(response.body as Basemap[])) {
        expect(layer.source).toMatchObject({ status: Status.UNRESOLVED, layer: null, capabilities: null });
      }
    });

    it('does not fall back to static capabilities when MapProxy is unreachable - catalog layers come back UNRESOLVED', async () => {
      process.env.MAP_SERVER_URL = 'http://127.0.0.1:1';
      const [unreachableApp] = await buildApp('true');
      const unreachableSender = await createRequestSender<paths, operations>('openapi3.yaml', unreachableApp);

      const response = await unreachableSender.listBasemaps();

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response).toSatisfyApiSpec();

      for (const layer of catalogLayers(response.body as Basemap[])) {
        expect(layer.source).toMatchObject({ status: Status.UNRESOLVED, layer: null, capabilities: null });
      }
    });

    it('gets a single fixture basemap', async () => {
      const response = await requestSender.getBasemap({ pathParams: { basemapId: 'basemap-14' } });

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response).toSatisfyApiSpec();

      const statuses = (response.body as Basemap).layers.map((layer) => [layer.id, layer.source.status]);

      expect(statuses).toEqual([
        ['layer-14-01', Status.RESOLVED],
        ['layer-14-02', Status.RESOLVED],
        ['layer-14-03', Status.RESOLVED],
        [UNRESOLVED_LAYER_ID, Status.UNRESOLVED],
      ]);
    });

    it('creates, updates and deletes in memory, with role validation still applied', async () => {
      const { id: fixtureId, ...writeInput } = MOCK_PERSISTED_BASEMAPS[0]!;

      const createResponse = await requestSender.createBasemap({ requestBody: { ...writeInput, name: 'Created in mock mode' } });

      expect(createResponse.status).toBe(httpStatusCodes.CREATED);
      expect(createResponse).toSatisfyApiSpec();

      const created = createResponse.body as Basemap;

      expect((await requestSender.getBasemap({ pathParams: { basemapId: fixtureId } })).body).toMatchObject({ isCurrent: false });

      const updateResponse = await requestSender.updateBasemap({
        pathParams: { basemapId: created.id },
        requestBody: { ...writeInput, name: 'Renamed', isCurrent: false },
      });

      expect(updateResponse.status).toBe(httpStatusCodes.OK);
      expect((updateResponse.body as Basemap).name).toBe('Renamed');

      const invalidResponse = await requestSender.updateBasemap({
        pathParams: { basemapId: created.id },
        requestBody: { ...writeInput, layers: [...writeInput.layers, { ...writeInput.layers[0]!, id: 'duplicate-order' }] },
      });

      expect(invalidResponse.status).toBe(httpStatusCodes.BAD_REQUEST);

      expect((await requestSender.deleteBasemap({ pathParams: { basemapId: created.id } })).status).toBe(httpStatusCodes.NO_CONTENT);
      expect((await requestSender.listBasemaps()).body as unknown[]).toHaveLength(MOCK_PERSISTED_BASEMAPS.length);
    });

    it('exports a fixture basemap without network access and validates the package back on import', async () => {
      const exportResponse = await request(app).get('/basemaps/basemap-14/export').buffer(true).parse(binaryParser);

      expect(exportResponse.status).toBe(httpStatusCodes.OK);

      const packageBuffer = exportResponse.body as Buffer;
      const zip = await jsZip.loadAsync(packageBuffer);

      expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['basemap.json', 'thumbnail.png']));

      const importResponse = await request(app)
        .post('/basemaps/import/validate')
        .attach('package', packageBuffer, { filename: 'basemap.zip', contentType: 'application/zip' });

      expect(importResponse.status).toBe(httpStatusCodes.OK);
      expect(importResponse).toSatisfyApiSpec();

      const review = importResponse.body as { name: string; layers: BasemapLayerOutput[]; thumbnail: { included: boolean } };

      expect(review.name).toBe('Custom Raster Composite');
      expect(review.thumbnail.included).toBe(true);
      expect(review.layers.map((layer) => layer.source.status)).toEqual([Status.RESOLVED, Status.RESOLVED, Status.RESOLVED, Status.UNRESOLVED]);
    });
  });
});
