import type { Domain, LayerRasterRecordModelType } from '@src/basemaps/models/catalogTypes';
import type { IRasterUniqueness } from '@src/basemaps/models/types';

export interface IRasterCatalogClient {
  resolveLayer: (domain: Domain.RASTER, uniqueness: IRasterUniqueness) => Promise<LayerRasterRecordModelType | null>;
}

export const RASTER_CATALOG_CLIENT = Symbol('RasterCatalogClient');
