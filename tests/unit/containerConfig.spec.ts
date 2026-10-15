import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect } from 'vitest';
import { rasterCatalogClientProvider } from '@src/containerConfig';
import { RASTER_CATALOG_CLIENT } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { StubRasterCatalogClient } from '@src/clients/rasterCatalog/stubRasterCatalogClient';

describe('rasterCatalogClientProvider', () => {
  it('registers the stub implementation for mode=stub', async () => {
    const provider = rasterCatalogClientProvider('stub', await jsLogger({ enabled: false }));

    expect(provider.token).toBe(RASTER_CATALOG_CLIENT);
    expect(provider.provider).toEqual({ useClass: StubRasterCatalogClient });
  });

  it('fails fast for mode=http rather than silently falling back to the stub', async () => {
    const logger = await jsLogger({ enabled: false });
    expect(() => rasterCatalogClientProvider('http', logger)).toThrow(/not implemented yet/);
  });
});
