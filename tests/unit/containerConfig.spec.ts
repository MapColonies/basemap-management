import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect } from 'vitest';
import { rasterCatalogClientProvider } from '@src/containerConfig';
import { RASTER_CATALOG_CLIENT } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { StubRasterCatalogClient } from '@src/clients/rasterCatalog/stubRasterCatalogClient';
import { HttpRasterCatalogClient } from '@src/clients/rasterCatalog/httpRasterCatalogClient';

describe('rasterCatalogClientProvider', () => {
  it('registers the stub implementation for mode=stub', async () => {
    const provider = rasterCatalogClientProvider('stub', await jsLogger({ enabled: false }));

    expect(provider.token).toBe(RASTER_CATALOG_CLIENT);
    expect(provider.provider).toEqual({ useClass: StubRasterCatalogClient });
  });

  it('registers the real PyCSW implementation for mode=http', async () => {
    const provider = rasterCatalogClientProvider('http', await jsLogger({ enabled: false }));

    expect(provider.token).toBe(RASTER_CATALOG_CLIENT);
    expect(provider.provider).toEqual({ useClass: HttpRasterCatalogClient });
  });
});
