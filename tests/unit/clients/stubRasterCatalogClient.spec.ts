import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect } from 'vitest';
import { ProductType } from '@map-colonies/types';
import { StubRasterCatalogClient } from '@src/clients/rasterCatalog/stubRasterCatalogClient';

describe('StubRasterCatalogClient', () => {
  it('always reports a Raster resource as unresolved', async () => {
    const client = new StubRasterCatalogClient(await jsLogger({ enabled: false }));

    await expect(client.resolve('12345', ProductType.ORTHOPHOTO)).resolves.toBeUndefined();
  });
});
