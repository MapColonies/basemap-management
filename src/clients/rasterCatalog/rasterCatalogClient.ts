import type { Domain } from '@map-colonies/types';
import type { LayerRasterRecord } from '@src/basemaps/models/catalogTypes';
import type { ResolvableRasterUniqueness } from '@src/basemaps/models/types';

export interface IRasterCatalogClient {
  resolveLayer: (domain: Domain.RASTER, uniqueness: ResolvableRasterUniqueness) => Promise<LayerRasterRecord | null>;
}

export const RASTER_CATALOG_CLIENT = Symbol('RasterCatalogClient');
