import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { Domain, ProductType } from '@src/basemaps/models/catalogTypes';
import { SourceTypeInput, SourceTypeOutput } from '@src/basemaps/models/types';
import { CatalogResourceResolver } from '@src/basemaps/models/catalogResourceResolver';
import { BasemapImportExportManager } from '@src/basemaps/models/basemapImportExportManager';
import { BasemapsManager } from '@src/basemaps/models/basemapsManager';
import { writeBasemapPackage } from '@src/basemaps/packaging/basemapPackageWriter';
import type { IConfigServerClient, IConfigServerDocument } from '@src/clients/configServer/configServerClient';
import type { IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import type { IMapServerCapabilitiesClient } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import type { IBasemap } from '@src/basemaps/models/types';

const DIMENSION = 128;
const KNOWN_PRODUCT_ID = '12345';
const WMTS_LINK_NAME = '12345-Orthophoto';
const RESOLVED_LAYER = {
  id: 'record-1',
  productName: 'France Satellite',
  links: [{ protocol: 'WMTS', name: WMTS_LINK_NAME, url: 'https://mapproxy/wmts' }],
};
const CAPABILITY = { id: WMTS_LINK_NAME, format: ['image/jpeg'], style: [{ value: 'default', isDefault: 'true' }], tileMatrixSet: [], url: [] };
const KNOWN_UNIQUENESS = { productId: KNOWN_PRODUCT_ID, productType: ProductType.ORTHOPHOTO };

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
      resolveLayer: vi.fn(async (_domain: Domain.RASTER, uniqueness: { productId: string }) =>
        uniqueness.productId === KNOWN_PRODUCT_ID ? RESOLVED_LAYER : null
      ),
    };
    const mapServerClient: IMapServerCapabilitiesClient = { getCapabilities: async () => Promise.resolve([CAPABILITY]) };
    const resolver = new CatalogResourceResolver(rasterCatalogClient, mapServerClient, logger);
    basemapsManager = new BasemapsManager(new FakeConfigServerClient(), resolver, logger);
    manager = new BasemapImportExportManager(basemapsManager, resolver, logger);

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
          source: { type: SourceTypeInput.CATALOG_RESOURCE, domain: Domain.RASTER, uniqueness: KNOWN_UNIQUENESS },
        },
      ],
    });
    // Creating `existingBasemap` already resolved its catalog layer once (every write resolves the
    // output it returns) - clear that call so "not.toHaveBeenCalled()" assertions below reflect only
    // what each test itself does.
    vi.mocked(rasterCatalogClient.resolveLayer).mockClear();
  });

  describe('#exportBasemap', () => {
    it('writes the persisted catalog layer through in its canonical input form - no identity translation needed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.resolve(new Response(buildPngBuffer(), { status: 200, headers: { 'content-type': 'image/png' } })))
      );

      const zipBuffer = await manager.exportBasemap(existingBasemap.id);
      const jsZip = (await import('jszip')).default;
      const zip = await jsZip.loadAsync(zipBuffer);
      const manifest = JSON.parse(await zip.file('basemap.json')!.async('string')) as { layers: { source: unknown }[] };

      expect(manifest.layers[0]?.source).toEqual({ type: SourceTypeInput.CATALOG_RESOURCE, domain: Domain.RASTER, uniqueness: KNOWN_UNIQUENESS });
      // export is a pure read of the persisted document - no catalog round-trip required.
      expect(rasterCatalogClient.resolveLayer).not.toHaveBeenCalled();

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
            source: { type: SourceTypeInput.EXTERNAL, details: { protocol: 'XYZ', name: 'n', url: 'https://example.com/{z}/{x}/{y}' } },
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
    it('resolves a CATALOG_RESOURCE layer that exists in this environment and reports no role conflict when isCurrent is false', async () => {
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
            source: { type: SourceTypeInput.CATALOG_RESOURCE as const, domain: Domain.RASTER as const, uniqueness: KNOWN_UNIQUENESS },
          },
        ],
      };
      const zipBuffer = await writeBasemapPackage(portable, buildPngBuffer());

      const review = await manager.validateImport(zipBuffer);

      expect(review.layers).toEqual([
        {
          status: 'RESOLVED',
          id: 'l1',
          order: 0,
          opacity: 1,
          shouldBeUsedInModelDraping: undefined,
          source: { type: SourceTypeOutput.RESOLVED_CATALOG_RESOURCE, domain: Domain.RASTER, layer: RESOLVED_LAYER, capabilities: CAPABILITY },
        },
      ]);
      expect(review.currentRoleConflict).toBeUndefined();
      expect(review.thumbnail).toMatchObject({ included: true, width: DIMENSION, height: DIMENSION });
    });

    it('reports an unresolved layer when the catalog resource is not found in this environment, without persisting anything', async () => {
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
            source: {
              type: SourceTypeInput.CATALOG_RESOURCE as const,
              domain: Domain.RASTER as const,
              uniqueness: { productId: 'unknown-product', productType: ProductType.ORTHOPHOTO },
            },
          },
        ],
      };
      const zipBuffer = await writeBasemapPackage(portable, buildPngBuffer());

      const review = await manager.validateImport(zipBuffer);

      expect(review.layers).toEqual([
        {
          status: 'UNRESOLVED',
          id: 'l1',
          order: 0,
          opacity: 1,
          shouldBeUsedInModelDraping: undefined,
          source: {
            type: SourceTypeOutput.UNRESOLVED_CATALOG_RESOURCE,
            domain: Domain.RASTER,
            uniqueness: { productId: 'unknown-product', productType: ProductType.ORTHOPHOTO },
          },
        },
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
            source: {
              type: SourceTypeInput.EXTERNAL as const,
              details: { protocol: 'XYZ' as const, name: 'n', url: 'https://example.com/{z}/{x}/{y}' },
            },
          },
        ],
      };
      const zipBuffer = await writeBasemapPackage(portable, buildPngBuffer());

      const review = await manager.validateImport(zipBuffer);

      expect(review.layers).toEqual([
        { status: 'RESOLVED', id: 'l1', order: 0, opacity: 0.5, shouldBeUsedInModelDraping: undefined, source: portable.layers[0]?.source },
      ]);
      expect(rasterCatalogClient.resolveLayer).not.toHaveBeenCalled();
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
