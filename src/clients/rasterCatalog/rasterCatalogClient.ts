import type { ProductType } from '@map-colonies/types';

export interface IRasterCatalogClient {
  resolve: (productId: string, productType: ProductType) => Promise<unknown>;
}

export const RASTER_CATALOG_CLIENT = Symbol('RasterCatalogClient');
