import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { ProductType } from '@map-colonies/types';
import { BasemapImportExportManager } from '@src/basemaps/models/basemapImportExportManager';
import { BasemapsManager } from '@src/basemaps/models/basemapsManager';
import { writeBasemapPackage } from '@src/basemaps/packaging/basemapPackageWriter';
import type { IConfigServerClient, IConfigServerDocument } from '@src/clients/configServer/configServerClient';
import type { IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import type { IBasemap } from '@src/basemaps/models/types';

const DIMENSION = 128;
const KNOWN_PRODUCT_ID = '12345';
const RESOLVED_LAYER = { name: 'France Satellite' };

class FakeConfigServerClient implements IConfigServerClient {
  public document: IConfigServerDocument = { basemaps: [] };

  // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
  public async getLatest(): Promise<{ document: IConfigServerDocument; version: number | undefined }> {
    return { document: this.document, version: undefined };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
  public async save(document: IConfigServerDocument): Promise<{ version: number }> {
    this.document = document;
    return { version: 1 };
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

describe('BasemapImportExportManager', () => {
  let basemapsManager: BasemapsManager;
  let rasterCatalogClient: IRasterCatalogClient;
  let manager: BasemapImportExportManager;
  let existingBasemap: IBasemap;

  beforeEach(async () => {
    const logger = await jsLogger({ enabled: false });
    rasterCatalogClient = {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
      resolve: vi.fn(async (productId: string) => (productId === KNOWN_PRODUCT_ID ? RESOLVED_LAYER : undefined)),
    };
    basemapsManager = new BasemapsManager(new FakeConfigServerClient(), rasterCatalogClient, logger);
    manager = new BasemapImportExportManager(basemapsManager, rasterCatalogClient, logger);

    existingBasemap = await basemapsManager.create({
      name: 'Existing Current',
      thumbnail: { url: 'https://example.com/thumb.png', width: DIMENSION, height: DIMENSION },
      isCurrent: true,
      isForPreview: false,
      layers: [
        {
          id: 'layer-1',
          order: 0,
          opacity: 1,
          source: { type: 'RASTER_RESOURCE', productId: KNOWN_PRODUCT_ID, productType: ProductType.ORTHOPHOTO },
        },
      ],
    });
    // Creating `existingBasemap` already resolved its Raster layer once (every write resolves the
    // output it returns) - clear that call so "not.toHaveBeenCalled()" assertions below reflect only
    // what each test itself does.
    vi.mocked(rasterCatalogClient.resolve).mockClear();
  });

  describe('#exportBasemap', () => {
    it('writes the persisted Raster layer through unchanged - no identity translation needed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.resolve(new Response(buildPngBuffer(), { status: 200, headers: { 'content-type': 'image/png' } })))
      );

      const zipBuffer = await manager.exportBasemap(existingBasemap.id);
      const jsZip = (await import('jszip')).default;
      const zip = await jsZip.loadAsync(zipBuffer);
      const manifest = JSON.parse(await zip.file('basemap.json')!.async('string')) as { layers: { source: { productId: string } }[] };

      expect(manifest.layers[0]?.source.productId).toBe(KNOWN_PRODUCT_ID);
      // export is a pure read of the persisted document - no Raster Catalog round-trip required.
      expect(rasterCatalogClient.resolve).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('passes an external layer through unchanged', async () => {
      const basemap = await basemapsManager.create({
        name: 'External Only',
        thumbnail: { url: 'https://example.com/thumb.png', width: DIMENSION, height: DIMENSION },
        isCurrent: false,
        isForPreview: false,
        layers: [
          {
            id: 'l1',
            order: 0,
            opacity: 1,
            source: { type: 'EXTERNAL', details: { protocol: 'XYZ', name: 'n', url: 'https://example.com/{z}/{x}/{y}' } },
          },
        ],
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.resolve(new Response(buildPngBuffer(), { status: 200, headers: { 'content-type': 'image/png' } })))
      );

      const zipBuffer = await manager.exportBasemap(basemap.id);

      expect(zipBuffer.length).toBeGreaterThan(0);

      vi.unstubAllGlobals();
    });

    it('throws NotFoundError for an unknown basemap id', async () => {
      await expect(manager.exportBasemap('missing-id')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws UpstreamServiceError when the thumbnail cannot be fetched (network failure)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))
      );

      await expect(manager.exportBasemap(existingBasemap.id)).rejects.toMatchObject({ statusCode: 502 });

      vi.unstubAllGlobals();
    });

    it('throws UpstreamServiceError when the thumbnail fetch returns a non-ok status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.resolve(new Response(null, { status: 404 })))
      );

      await expect(manager.exportBasemap(existingBasemap.id)).rejects.toMatchObject({ statusCode: 502 });

      vi.unstubAllGlobals();
    });
  });

  describe('#validateImport', () => {
    it('resolves a RASTER_RESOURCE layer that exists in this environment and reports no role conflict when isCurrent is false', async () => {
      const portable = {
        name: 'Imported Basemap',
        isCurrent: false,
        isForPreview: false,
        thumbnail: { file: 'thumbnail.png', width: DIMENSION, height: DIMENSION },
        layers: [
          {
            id: 'l1',
            order: 0,
            opacity: 1,
            source: { type: 'RASTER_RESOURCE' as const, productId: KNOWN_PRODUCT_ID, productType: ProductType.ORTHOPHOTO },
          },
        ],
      };
      const zipBuffer = await writeBasemapPackage(portable, buildPngBuffer());

      const review = await manager.validateImport(zipBuffer);

      expect(review.layers).toEqual([{ status: 'RESOLVED', opacity: 1, shouldBeUsedInModelDraping: undefined, source: portable.layers[0]?.source }]);
      expect(review.currentRoleConflict).toBeUndefined();
      expect(review.thumbnail).toMatchObject({ included: true, width: DIMENSION, height: DIMENSION });
    });

    it('reports an unresolved layer when the Raster resource is not found in this environment, without persisting anything', async () => {
      const portable = {
        name: 'Imported Basemap',
        isCurrent: false,
        isForPreview: false,
        thumbnail: { file: 'thumbnail.png', width: DIMENSION, height: DIMENSION },
        layers: [
          {
            id: 'l1',
            order: 0,
            opacity: 1,
            source: { type: 'RASTER_RESOURCE' as const, productId: 'unknown-product', productType: ProductType.ORTHOPHOTO },
          },
        ],
      };
      const zipBuffer = await writeBasemapPackage(portable, buildPngBuffer());

      const review = await manager.validateImport(zipBuffer);

      expect(review.layers).toEqual([
        { status: 'UNRESOLVED', opacity: 1, shouldBeUsedInModelDraping: undefined, source: portable.layers[0]?.source },
      ]);
      // validateImport must never persist - the existing basemap list is untouched.
      await expect(basemapsManager.list()).resolves.toHaveLength(1);
    });

    it('marks an external layer as resolved without any raster lookup', async () => {
      const portable = {
        name: 'Imported Basemap',
        isCurrent: false,
        isForPreview: false,
        thumbnail: { file: 'thumbnail.png', width: DIMENSION, height: DIMENSION },
        layers: [
          {
            id: 'l1',
            order: 0,
            opacity: 0.5,
            source: { type: 'EXTERNAL' as const, details: { protocol: 'XYZ' as const, name: 'n', url: 'https://example.com/{z}/{x}/{y}' } },
          },
        ],
      };
      const zipBuffer = await writeBasemapPackage(portable, buildPngBuffer());

      const review = await manager.validateImport(zipBuffer);

      expect(review.layers).toEqual([
        { status: 'RESOLVED', opacity: 0.5, shouldBeUsedInModelDraping: undefined, source: portable.layers[0]?.source },
      ]);
      expect(rasterCatalogClient.resolve).not.toHaveBeenCalled();
    });

    it('flags a role conflict when the import claims isCurrent and another basemap already owns it', async () => {
      const portable = {
        name: 'Imported Basemap',
        isCurrent: true,
        isForPreview: false,
        thumbnail: { file: 'thumbnail.png', width: DIMENSION, height: DIMENSION },
        layers: [],
      };
      const zipBuffer = await writeBasemapPackage(portable, buildPngBuffer());

      const review = await manager.validateImport(zipBuffer);

      expect(review.currentRoleConflict).toEqual({ basemapId: existingBasemap.id, basemapName: 'Existing Current' });
    });
  });
});
