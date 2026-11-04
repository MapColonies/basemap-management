import type { Domain, LayerRasterRecordModelType } from '@src/basemaps/models/catalogTypes';
import type { IResolvableRasterUniqueness } from '@src/basemaps/models/types';

export interface IRasterCatalogClient {
  resolveLayer: (domain: Domain.RASTER, uniqueness: IResolvableRasterUniqueness) => Promise<LayerRasterRecordModelType | null>;
}

export const RASTER_CATALOG_CLIENT = Symbol('RasterCatalogClient');
