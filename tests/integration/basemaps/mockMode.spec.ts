import jsZip from 'jszip';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, afterEach, it, expect, beforeAll } from 'vitest';
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
import { FixtureRasterCatalogClient } from '@src/clients/rasterCatalog/fixtureRasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import { HttpMapServerCapabilitiesClient } from '@src/clients/mapServer/httpMapServerCapabilitiesClient';
import { FixtureMapServerCapabilitiesClient } from '@src/clients/mapServer/fixtureMapServerCapabilitiesClient';
import { MOCK_PERSISTED_BASEMAPS } from '@src/basemaps/mock/mockBasemaps';
import { MOCK_RASTER_RECORD } from '@src/basemaps/mock/mockRasterRecord';
import { MOCK_CAPABILITIES } from '@src/basemaps/mock/mockCapabilities';

const BASEMAP_RESPONSE_SCHEMA = createBasemapSchema(LayerRasterRecordSchema, CapabilityWMTSSchema);
const UNRESOLVED_LAYER_ID = 'layer-14-04';

function binaryParser(res: SuperagentResponse, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function buildApp(mockData: string | undefined): Promise<[Application, DependencyContainer]> {
  if (mockData === undefined) {
    delete process.env.BASEMAP_MOCK_DATA;
  } else {
    process.env.BASEMAP_MOCK_DATA = mockData;
  }
  return getApp({
    override: [
      { token: SERVICES.LOGGER, provider: { useValue: await jsLogger({ enabled: false }) } },
      { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
    ],
    useChild: true,
  });
}

describe('BASEMAP_MOCK_DATA', () => {
  const originalValue = process.env.BASEMAP_MOCK_DATA;

  beforeAll(async () => {
    await initConfig(true);
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.BASEMAP_MOCK_DATA;
    } else {
      process.env.BASEMAP_MOCK_DATA = originalValue;
    }
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

    it('registers the fixture-backed data-source clients', () => {
      expect(container.resolve(CONFIG_SERVER_CLIENT)).toBeInstanceOf(InMemoryConfigServerClient);
      expect(container.resolve(RASTER_CATALOG_CLIENT)).toBeInstanceOf(FixtureRasterCatalogClient);
      expect(container.resolve(MAP_SERVER_CAPABILITIES_CLIENT)).toBeInstanceOf(FixtureMapServerCapabilitiesClient);
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
        expect(layer.source).toMatchObject({ status: Status.RESOLVED, layer: { id: MOCK_RASTER_RECORD.id }, capabilities: MOCK_CAPABILITIES[0] });
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

      // isCurrent moved to the new basemap: the real role policy cleared it from the fixture owner.
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
