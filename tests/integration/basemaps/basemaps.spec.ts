import jsZip from 'jszip';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, beforeAll } from 'vitest';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import request from 'supertest';
import type { Response as SuperagentResponse } from 'superagent';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { Application } from 'express';
import type { paths, operations } from '@openapi';
import { Domain, ProductType } from '@src/basemaps/models/catalogTypes';
import { SourceTypeInput, SourceTypeOutput } from '@src/basemaps/models/types';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { initConfig } from '@src/common/config';
import { CONFIG_SERVER_CLIENT, type IConfigServerClient, type IConfigServerDocument } from '@src/clients/configServer/configServerClient';
import { BLOB_STORAGE_CLIENT, type IBlobStorageClient, type IUploadBlobParams } from '@src/clients/blobStorage/blobStorageClient';
import { RASTER_CATALOG_CLIENT, type IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT, type IMapServerCapabilitiesClient } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import type { CapabilityModelType, LayerRasterRecordModelType } from '@src/basemaps/models/catalogTypes';

const DIMENSION = 128;
const KNOWN_PRODUCT_ID = '12345';
const WMTS_LINK_NAME = '12345-Orthophoto';
const RESOLVED_LAYER: LayerRasterRecordModelType = {
  id: 'record-1',
  productName: 'France Satellite',
  links: [{ protocol: 'WMTS', name: WMTS_LINK_NAME, url: 'https://mapproxy/wmts' }],
};
const CAPABILITY: CapabilityModelType = {
  id: WMTS_LINK_NAME,
  style: [{ value: 'default', isDefault: 'true' }],
  format: ['image/jpeg'],
  tileMatrixSet: [{ tileMatrixSetID: 'WorldCRS84', tileMatrixLabels: ['0', '1'] }],
  url: [{ format: 'image/jpeg', resourceType: 'tile', template: 'https://mapproxy/wmts/{TileMatrix}/{TileCol}/{TileRow}.jpeg' }],
};

/** supertest/superagent does not buffer unrecognized content types (like application/zip) into `response.body` by default. */
function binaryParser(res: SuperagentResponse, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

class FakeConfigServerClient implements IConfigServerClient {
  public document: IConfigServerDocument = { basemaps: [] };
  public version: number | undefined = undefined;

  // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
  public async getLatest(): Promise<{ document: IConfigServerDocument; version: number | undefined }> {
    return { document: this.document, version: this.version };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
  public async save(document: IConfigServerDocument, baseVersion: number | undefined): Promise<{ version: number }> {
    if (baseVersion !== this.version) {
      throw new Error('stale write');
    }
    this.document = document;
    this.version = (this.version ?? 0) + 1;
    return { version: this.version };
  }
}

class FakeBlobStorageClient implements IBlobStorageClient {
  // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
  public async upload(params: IUploadBlobParams): Promise<{ url: string }> {
    return { url: `data:${params.contentType};base64,${params.body.toString('base64')}` };
  }
}

class FakeRasterCatalogClient implements IRasterCatalogClient {
  // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
  public async resolveLayer(_domain: Domain.RASTER, uniqueness: { productId: string }): Promise<LayerRasterRecordModelType | null> {
    return uniqueness.productId === KNOWN_PRODUCT_ID ? RESOLVED_LAYER : null;
  }
}

class FakeMapServerCapabilitiesClient implements IMapServerCapabilitiesClient {
  public capabilities: CapabilityModelType[] = [CAPABILITY];

  // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
  public async getCapabilities(): Promise<CapabilityModelType[]> {
    return this.capabilities;
  }
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
  let configServerClient: FakeConfigServerClient;
  let mapServerClient: FakeMapServerCapabilitiesClient;

  beforeAll(async () => {
    await initConfig(true);
  });

  beforeEach(async () => {
    configServerClient = new FakeConfigServerClient();
    mapServerClient = new FakeMapServerCapabilitiesClient();
    [app] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: await jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        { token: CONFIG_SERVER_CLIENT, provider: { useValue: configServerClient } },
        { token: BLOB_STORAGE_CLIENT, provider: { useValue: new FakeBlobStorageClient() } },
        { token: RASTER_CATALOG_CLIENT, provider: { useValue: new FakeRasterCatalogClient() } },
        { token: MAP_SERVER_CAPABILITIES_CLIENT, provider: { useValue: mapServerClient } },
      ],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
  });

  async function uploadThumbnail(): Promise<{ url: string; width: 128; height: 128 }> {
    const response = await request(app)
      .post('/basemaps/thumbnails')
      .attach('thumbnail', buildPngBuffer(), { filename: 'thumb.png', contentType: 'image/png' });

    expect(response.status).toBe(httpStatusCodes.CREATED);

    return response.body as { url: string; width: 128; height: 128 };
  }

  describe('thumbnail upload', () => {
    it('accepts a valid 128x128 PNG and returns a server-generated URL', async () => {
      const response = await request(app)
        .post('/basemaps/thumbnails')
        .attach('thumbnail', buildPngBuffer(), { filename: 'thumb.png', contentType: 'image/png' });

      expect(response.status).toBe(httpStatusCodes.CREATED);
      expect(response.body).toMatchObject({ width: DIMENSION, height: DIMENSION });

      const body = response.body as { url: string };

      expect(body.url).not.toContain('thumb.png'); // the client-supplied filename must never leak into the storage key
    });

    it('rejects a MIME type claiming image/png when the bytes are not actually a PNG', async () => {
      const response = await request(app)
        .post('/basemaps/thumbnails')
        .attach('thumbnail', Buffer.from('not a real png'), { filename: 'thumb.png', contentType: 'image/png' });

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('rejects a real PNG with the wrong dimensions', async () => {
      const wrongSize = 64;
      const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const chunkLength = Buffer.alloc(4);
      chunkLength.writeUInt32BE(13);
      const width = Buffer.alloc(4);
      width.writeUInt32BE(wrongSize);
      const height = Buffer.alloc(4);
      height.writeUInt32BE(wrongSize);
      const badPng = Buffer.concat([signature, chunkLength, Buffer.from('IHDR', 'ascii'), width, height, Buffer.alloc(9)]);

      const response = await request(app)
        .post('/basemaps/thumbnails')
        .attach('thumbnail', badPng, { filename: 'thumb.png', contentType: 'image/png' });

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('rejects an oversized upload', async () => {
      const oversized = Buffer.alloc(3 * 1024 * 1024);
      const response = await request(app)
        .post('/basemaps/thumbnails')
        .attach('thumbnail', oversized, { filename: 'thumb.png', contentType: 'image/png' });

      expect(response.status).toBeGreaterThanOrEqual(httpStatusCodes.BAD_REQUEST);
    });
  });

  describe('CRUD', () => {
    it('creates, lists, gets, updates, and deletes a basemap', async () => {
      const thumbnail = await uploadThumbnail();

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
      const thumbnail = await uploadThumbnail();

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
              source: { type: SourceTypeInput.EXTERNAL, details: { protocol: 'XYZ', name: 'n', url: 'https://example.com/{z}/{x}/{y}' } },
            },
          ],
        },
      });

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('returns 404 for an unknown basemap id', async () => {
      const response = await requestSender.getBasemap({ pathParams: { basemapId: 'does-not-exist' } });

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });

    it('returns 404 when updating an unknown basemap id', async () => {
      const thumbnail = await uploadThumbnail();
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
      const thumbnail = await uploadThumbnail();
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
      const thumbnail = await uploadThumbnail();
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
                type: SourceTypeInput.CATALOG_RESOURCE,
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

      // the portable form is the canonical input source - no environment-specific id, no resolved layer.
      expect(manifest.layers[0]?.source).toEqual({
        type: SourceTypeInput.CATALOG_RESOURCE,
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
        type: SourceTypeOutput.RESOLVED_CATALOG_RESOURCE,
        domain: Domain.RASTER,
        layer: RESOLVED_LAYER,
        capabilities: CAPABILITY,
      });
    });

    it('returns the layer as UNRESOLVED_CATALOG_RESOURCE when MapProxy has no matching capability', async () => {
      const basemapId = await createBasemapWithRasterLayer();
      mapServerClient.capabilities = [];

      const response = await requestSender.getBasemap({ pathParams: { basemapId } });

      expect(response).toSatisfyApiSpec();

      const body = response.body as { layers: { source: unknown }[] };

      expect(body.layers[0]?.source).toEqual({
        type: SourceTypeOutput.UNRESOLVED_CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness: { productId: KNOWN_PRODUCT_ID, productType: ProductType.ORTHOPHOTO },
      });
    });

    it.each([
      ['an output-only RESOLVED_CATALOG_RESOURCE', { type: 'RESOLVED_CATALOG_RESOURCE', domain: 'RASTER', layer: {}, capabilities: { id: 'x' } }],
      [
        'an output-only UNRESOLVED_CATALOG_RESOURCE',
        { type: 'UNRESOLVED_CATALOG_RESOURCE', domain: 'RASTER', uniqueness: { productId: 'p', productType: 'Orthophoto' } },
      ],
      ['the legacy RASTER_RESOURCE shape', { type: 'RASTER_RESOURCE', productId: 'p', productType: 'Orthophoto' }],
      ['an unsupported domain', { type: 'CATALOG_RESOURCE', domain: 'VECTOR', uniqueness: { productId: 'p', productType: 'Orthophoto' } }],
    ])('rejects a write whose layer source is %s with 400', async (_label, source) => {
      const thumbnail = await uploadThumbnail();

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
              type: SourceTypeInput.CATALOG_RESOURCE,
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

      const body = response.body as { layers: { status: string; source: unknown }[] };

      expect(body.layers[0]?.status).toBe('UNRESOLVED');
      expect(body.layers[0]?.source).toEqual({
        type: SourceTypeOutput.UNRESOLVED_CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness: { productId: 'unknown-product', productType: ProductType.ORTHOPHOTO },
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
