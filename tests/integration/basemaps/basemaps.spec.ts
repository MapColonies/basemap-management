import jsZip from 'jszip';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, beforeAll } from 'vitest';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import request from 'supertest';
import type { Response as SuperagentResponse } from 'superagent';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { Application } from 'express';
import type { CapabilityWMTS } from '@map-colonies/wmts-client';
import { Domain, ProductType } from '@map-colonies/types';
import { SourceType } from '@map-colonies/app-shared';
import type { paths, operations } from '@openapi';
import { Status, type PersistedBasemap } from '@src/basemaps/models/types';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { initConfig } from '@src/common/config';
import { CONFIG_SERVER_CLIENT } from '@src/clients/configServer/configServerClient';
import { InMemoryConfigServerClient } from '@src/clients/configServer/inMemoryConfigServerClient';
import { RASTER_CATALOG_CLIENT, type IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT, type IMapServerCapabilitiesClient } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import type { LayerRasterRecord } from '@src/basemaps/models/catalogTypes';

const DIMENSION = 128;
const KNOWN_PRODUCT_ID = '12345';
const WMTS_LINK_NAME = '12345-Orthophoto';
const RESOLVED_LAYER: LayerRasterRecord = {
  id: 'record-1',
  productId: KNOWN_PRODUCT_ID,
  productType: ProductType.ORTHOPHOTO,
  productName: 'France Satellite',
  links: [{ protocol: 'WMTS', name: WMTS_LINK_NAME, url: 'https://mapproxy/wmts' }],
};
const CAPABILITY: CapabilityWMTS = {
  id: WMTS_LINK_NAME,
  style: [{ value: 'default', isDefault: 'true' }],
  format: ['image/jpeg'],
  tileMatrixSet: [{ tileMatrixSetID: 'WorldCRS84', tileMatrixLabels: ['0', '1'] }],
  url: [{ format: 'image/jpeg', resourceType: 'tile', template: 'https://mapproxy/wmts/{TileMatrix}/{TileCol}/{TileRow}.jpeg' }],
};

function binaryParser(res: SuperagentResponse, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

function buildPngBuffer(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunkLength = Buffer.alloc(4);
  chunkLength.writeUInt32BE(13);
  const chunkType = Buffer.from('IHDR', 'ascii');
  const width = Buffer.alloc(4);
  width.writeUInt32BE(DIMENSION);
  const height = Buffer.alloc(4);
  height.writeUInt32BE(DIMENSION);
  return Buffer.concat([signature, chunkLength, chunkType, width, height, Buffer.alloc(9)]);
}

describe('basemaps', () => {
  let app: Application;
  let requestSender: RequestSender<paths, operations>;
  let configServerClient: InMemoryConfigServerClient;
  const rasterCatalogClient: IRasterCatalogClient = {
    resolveLayer: async (_domain, { productId, productType }) =>
      Promise.resolve(RESOLVED_LAYER.productId === productId && RESOLVED_LAYER.productType === productType ? RESOLVED_LAYER : null),
  };
  let mapServerCapabilities: CapabilityWMTS[];
  const mapServerClient: IMapServerCapabilitiesClient = {
    getCapabilities: async () => Promise.resolve(mapServerCapabilities),
  };

  beforeAll(async () => {
    await initConfig(true);
  });

  beforeEach(async () => {
    configServerClient = new InMemoryConfigServerClient();
    mapServerCapabilities = [CAPABILITY];
    [app] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: await jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        { token: CONFIG_SERVER_CLIENT, provider: { useValue: configServerClient } },
        { token: RASTER_CATALOG_CLIENT, provider: { useValue: rasterCatalogClient } },
        { token: MAP_SERVER_CAPABILITIES_CLIENT, provider: { useValue: mapServerClient } },
      ],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
  });

  function readyThumbnail(): { url: string; width: 128; height: 128 } {
    return { url: `data:image/png;base64,${buildPngBuffer().toString('base64')}`, width: DIMENSION, height: DIMENSION };
  }

  describe('removed thumbnail upload endpoint', () => {
    it('no longer exposes POST /basemaps/thumbnails', async () => {
      const response = await request(app)
        .post('/basemaps/thumbnails')
        .attach('thumbnail', buildPngBuffer(), { filename: 'thumb.png', contentType: 'image/png' });

      expect(response.status).not.toBe(httpStatusCodes.CREATED);
      expect(response.status).toBeGreaterThanOrEqual(httpStatusCodes.BAD_REQUEST);
    });
  });

  describe('CRUD', () => {
    it('creates, lists, gets, updates, and deletes a basemap', async () => {
      const thumbnail = readyThumbnail();

      const createResponse = await requestSender.createBasemap({
        requestBody: { name: 'Satellite Europe', thumbnail, isCurrent: false, isForPreview: false, layers: [] },
      });

      expect(createResponse.status).toBe(httpStatusCodes.CREATED);
      expect(createResponse).toSatisfyApiSpec();

      const basemapId = (createResponse.body as { id: string }).id;

      const listResponse = await requestSender.listBasemaps();

      expect(listResponse.status).toBe(httpStatusCodes.OK);
      expect(listResponse.body as unknown[]).toHaveLength(1);

      const getResponse = await requestSender.getBasemap({ pathParams: { basemapId } });

      expect(getResponse.status).toBe(httpStatusCodes.OK);
      expect((getResponse.body as { name: string }).name).toBe('Satellite Europe');

      const updateResponse = await requestSender.updateBasemap({
        pathParams: { basemapId },
        requestBody: { name: 'Renamed', thumbnail, isCurrent: false, isForPreview: false, layers: [] },
      });

      expect(updateResponse.status).toBe(httpStatusCodes.OK);
      expect((updateResponse.body as { name: string }).name).toBe('Renamed');

      const deleteResponse = await requestSender.deleteBasemap({ pathParams: { basemapId } });

      expect(deleteResponse.status).toBe(httpStatusCodes.NO_CONTENT);

      const afterDelete = await requestSender.getBasemap({ pathParams: { basemapId } });

      expect(afterDelete.status).toBe(httpStatusCodes.NOT_FOUND);
    });

    it('rejects an invalid opacity with 400', async () => {
      const thumbnail = readyThumbnail();

      const response = await requestSender.createBasemap({
        requestBody: {
          name: 'Bad Opacity',
          thumbnail,
          isCurrent: false,
          isForPreview: false,
          layers: [
            {
              id: 'l1',
              order: 0,
              opacity: 2,
              source: { type: SourceType.EXTERNAL, details: { protocol: 'XYZ', name: 'n', url: 'https://example.com/{z}/{x}/{y}' } },
            },
          ],
        },
      });

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect((response.body as { message: string }).message).toBe('request/body/layers/0/opacity must be <= 1');
    });

    it.each(['', '   '])('should reject the blank thumbnail url %j with 400 from the Zod validation', async (url) => {
      const response = await request(app)
        .post('/basemaps')
        .send({ name: 'Blank Thumbnail', thumbnail: { ...readyThumbnail(), url }, isCurrent: false, isForPreview: false, layers: [] });

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toEqual({ message: 'thumbnail.url: thumbnail.url must not be empty' });
      expect(configServerClient.document.basemaps).toEqual([]);
    });

    it('returns 404 for an unknown basemap id', async () => {
      const response = await requestSender.getBasemap({ pathParams: { basemapId: 'does-not-exist' } });

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });

    it('returns 404 when updating an unknown basemap id', async () => {
      const thumbnail = readyThumbnail();
      const response = await requestSender.updateBasemap({
        pathParams: { basemapId: 'does-not-exist' },
        requestBody: { name: 'x', thumbnail, isCurrent: false, isForPreview: false, layers: [] },
      });

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });

    it('returns 404 when deleting an unknown basemap id', async () => {
      const response = await requestSender.deleteBasemap({ pathParams: { basemapId: 'does-not-exist' } });

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });

    it('setting isCurrent on a new basemap clears it from the previous owner', async () => {
      const thumbnail = readyThumbnail();
      const first = await requestSender.createBasemap({
        requestBody: { name: 'First', thumbnail, isCurrent: true, isForPreview: false, layers: [] },
      });
      const firstId = (first.body as { id: string }).id;

      await requestSender.createBasemap({ requestBody: { name: 'Second', thumbnail, isCurrent: true, isForPreview: false, layers: [] } });

      const refreshedFirst = await requestSender.getBasemap({ pathParams: { basemapId: firstId } });

      expect((refreshedFirst.body as { isCurrent: boolean }).isCurrent).toBe(false);
    });

    it('surfaces a config-server failure as an error response rather than hanging', async () => {
      configServerClient.getLatest = async () => Promise.reject(new Error('config-server unreachable'));

      const response = await requestSender.listBasemaps();

      expect(response.status).toBeGreaterThanOrEqual(httpStatusCodes.INTERNAL_SERVER_ERROR);
    });
  });

  describe('export / import', () => {
    async function createBasemapWithRasterLayer(): Promise<string> {
      const thumbnail = readyThumbnail();
      const createResponse = await requestSender.createBasemap({
        requestBody: {
          name: 'Satellite Europe',
          thumbnail,
          isCurrent: false,
          isForPreview: false,
          layers: [
            {
              id: 'l1',
              order: 0,
              opacity: 1,
              source: {
                type: SourceType.CATALOG_RESOURCE,
                domain: Domain.RASTER,
                uniqueness: { productId: KNOWN_PRODUCT_ID, productType: ProductType.ORTHOPHOTO },
              },
            },
          ],
        },
      });
      return (createResponse.body as { id: string }).id;
    }

    it('exports a basemap as a ZIP containing basemap.json and the thumbnail binary', async () => {
      const basemapId = await createBasemapWithRasterLayer();

      const response = await request(app).get(`/basemaps/${basemapId}/export`).buffer(true).parse(binaryParser);

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.headers['content-type']).toContain('application/zip');

      const zip = await jsZip.loadAsync(response.body as Buffer);

      expect(Object.keys(zip.files)).toContain('basemap.json');

      const manifest = JSON.parse(await zip.file('basemap.json')!.async('string')) as { layers: { source: unknown }[] };

      expect(manifest.layers[0]?.source).toEqual({
        type: SourceType.CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness: { productId: KNOWN_PRODUCT_ID, productType: ProductType.ORTHOPHOTO },
      });
    });

    it('resolves a persisted catalog layer into its record and MapProxy capabilities on GET', async () => {
      const basemapId = await createBasemapWithRasterLayer();

      const response = await requestSender.getBasemap({ pathParams: { basemapId } });

      expect(response).toSatisfyApiSpec();

      const body = response.body as { layers: { source: unknown }[] };

      expect(body.layers[0]?.source).toEqual({
        type: SourceType.CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness: { productId: KNOWN_PRODUCT_ID, productType: ProductType.ORTHOPHOTO },
        status: Status.RESOLVED,
        layer: RESOLVED_LAYER,
        capabilities: CAPABILITY,
      });
    });

    it('accepts a read response sent back as an update and persists only the input contract', async () => {
      const basemapId = await createBasemapWithRasterLayer();
      const read = (await requestSender.getBasemap({ pathParams: { basemapId } })).body as Record<string, unknown> & { layers: unknown[] };
      const response = await request(app)
        .put(`/basemaps/${basemapId}`)
        .send({ ...read, id: undefined });

      expect(response.status).toBe(httpStatusCodes.OK);
      expect((configServerClient.document.basemaps as PersistedBasemap[])[0]?.layers[0]?.source).toEqual({
        type: SourceType.CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness: { productId: KNOWN_PRODUCT_ID, productType: ProductType.ORTHOPHOTO },
      });
    });

    it('returns an external layer as RESOLVED with its details unchanged on GET', async () => {
      const thumbnail = readyThumbnail();
      const details = { protocol: 'WMTS' as const, name: 'osm', url: 'https://example.com/wmts', layer: 'ortho' };
      const createResponse = await requestSender.createBasemap({
        requestBody: {
          name: 'External',
          thumbnail,
          isCurrent: false,
          isForPreview: false,
          layers: [{ id: 'l1', order: 0, opacity: 1, source: { type: SourceType.EXTERNAL, details } }],
        },
      });
      const basemapId = (createResponse.body as { id: string }).id;

      const response = await requestSender.getBasemap({ pathParams: { basemapId } });

      expect(response).toSatisfyApiSpec();

      const body = response.body as { layers: { source: unknown }[] };

      expect(body.layers[0]?.source).toEqual({ type: SourceType.EXTERNAL, status: Status.RESOLVED, details });
    });

    it('accepts a catalog layer with an incomplete uniqueness and returns it as UNRESOLVED on GET', async () => {
      const thumbnail = readyThumbnail();
      const uniqueness = { productId: null, productType: ProductType.ORTHOPHOTO };
      const createResponse = await request(app)
        .post('/basemaps')
        .send({
          name: 'Incomplete',
          thumbnail,
          isCurrent: false,
          isForPreview: false,
          layers: [{ id: 'l1', order: 0, opacity: 1, source: { type: SourceType.CATALOG_RESOURCE, domain: Domain.RASTER, uniqueness } }],
        });

      expect(createResponse.status).toBe(httpStatusCodes.CREATED);

      const response = await requestSender.getBasemap({ pathParams: { basemapId: (createResponse.body as { id: string }).id } });

      expect(response).toSatisfyApiSpec();
      expect((response.body as { layers: { source: unknown }[] }).layers[0]?.source).toEqual({
        type: SourceType.CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness,
        status: Status.UNRESOLVED,
        layer: null,
        capabilities: null,
      });
    });

    it('still rejects a catalog layer whose uniqueness values have the wrong JSON type with 400', async () => {
      const thumbnail = readyThumbnail();

      const response = await request(app)
        .post('/basemaps')
        .send({
          name: 'Malformed',
          thumbnail,
          isCurrent: false,
          isForPreview: false,
          layers: [{ id: 'l1', order: 0, opacity: 1, source: { type: 'CATALOG_RESOURCE', domain: 'RASTER', uniqueness: { productId: 12345 } } }],
        });

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('returns the layer as UNRESOLVED with null layer/capabilities when MapProxy has no matching capability', async () => {
      const basemapId = await createBasemapWithRasterLayer();
      mapServerCapabilities = [];

      const response = await requestSender.getBasemap({ pathParams: { basemapId } });

      expect(response).toSatisfyApiSpec();

      const body = response.body as { layers: { source: unknown }[] };

      expect(body.layers[0]?.source).toEqual({
        type: SourceType.CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness: { productId: KNOWN_PRODUCT_ID, productType: ProductType.ORTHOPHOTO },
        status: Status.UNRESOLVED,
        layer: null,
        capabilities: null,
      });
    });

    it.each([
      [
        'an output-shaped RESOLVED source (status/layer/capabilities instead of uniqueness)',
        { type: 'CATALOG_RESOURCE', domain: 'RASTER', status: 'RESOLVED', layer: {}, capabilities: { id: 'x' } },
      ],
      [
        'an output-shaped UNRESOLVED source (status/layer/capabilities instead of uniqueness)',
        { type: 'CATALOG_RESOURCE', domain: 'RASTER', status: 'UNRESOLVED', layer: null, capabilities: null },
      ],
      ['the legacy RASTER_RESOURCE shape', { type: 'RASTER_RESOURCE', productId: 'p', productType: 'Orthophoto' }],
      ['an unsupported domain', { type: 'CATALOG_RESOURCE', domain: 'VECTOR', uniqueness: { productId: 'p', productType: 'Orthophoto' } }],
    ])('rejects a write whose layer source is %s with 400', async (_label, source) => {
      const thumbnail = readyThumbnail();

      const response = await request(app)
        .post('/basemaps')
        .send({ name: 'Bad', thumbnail, isCurrent: false, isForPreview: false, layers: [{ id: 'l1', order: 0, opacity: 1, source }] });

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('validates an import package and reports an unresolved catalog layer without persisting anything', async () => {
      const portable = {
        name: 'Imported',
        isCurrent: false,
        isForPreview: false,
        thumbnail: { file: 'thumbnail.png', width: DIMENSION, height: DIMENSION },
        layers: [
          {
            id: 'l1',
            order: 0,
            opacity: 1,
            source: {
              type: SourceType.CATALOG_RESOURCE,
              domain: Domain.RASTER,
              uniqueness: { productId: 'unknown-product', productType: ProductType.ORTHOPHOTO },
            },
          },
        ],
      };

      const zip = new jsZip();
      zip.file('basemap.json', JSON.stringify(portable));
      zip.file('thumbnail.png', buildPngBuffer());
      const packageBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const response = await request(app)
        .post('/basemaps/import/validate')
        .attach('package', packageBuffer, { filename: 'basemap.zip', contentType: 'application/zip' });

      expect(response.status).toBe(httpStatusCodes.OK);

      expect(response).toSatisfyApiSpec();

      const body = response.body as { layers: Record<string, unknown>[] };

      expect(body.layers[0]).not.toHaveProperty('status');
      expect(body.layers[0]?.source).toEqual({
        type: SourceType.CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness: { productId: 'unknown-product', productType: ProductType.ORTHOPHOTO },
        status: Status.UNRESOLVED,
        layer: null,
        capabilities: null,
      });

      const listResponse = await requestSender.listBasemaps();

      expect(listResponse.body).toEqual([]);
    });

    it('returns 404 when exporting an unknown basemap id', async () => {
      const response = await request(app).get('/basemaps/does-not-exist/export');

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });

    it('returns 400 when the import package is not a valid ZIP', async () => {
      const response = await request(app)
        .post('/basemaps/import/validate')
        .attach('package', Buffer.from('not a zip'), { filename: 'basemap.zip', contentType: 'application/zip' });

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });
  });
});
