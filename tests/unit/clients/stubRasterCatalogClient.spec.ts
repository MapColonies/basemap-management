import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect } from 'vitest';
import { Domain, ProductType } from '@src/basemaps/models/catalogTypes';
import { StubRasterCatalogClient } from '@src/clients/rasterCatalog/stubRasterCatalogClient';

describe('StubRasterCatalogClient', () => {
  it('always reports a catalog resource as not found', async () => {
    const client = new StubRasterCatalogClient(await jsLogger({ enabled: false }));

    await expect(client.resolveLayer(Domain.RASTER, { productId: '12345', productType: ProductType.ORTHOPHOTO })).resolves.toBeNull();
  });
});
