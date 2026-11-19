import type { Domain } from '@map-colonies/types';
import type { LayerRasterRecord } from '@src/basemaps/models/catalogTypes';
import type { ResolvableRasterUniqueness } from '@src/basemaps/models/types';
import type { IRasterCatalogClient } from './rasterCatalogClient';

export class FixtureRasterCatalogClient implements IRasterCatalogClient {
  public constructor(private readonly records: readonly LayerRasterRecord[]) {}

  public async resolveLayer(_domain: Domain.RASTER, uniqueness: ResolvableRasterUniqueness): Promise<LayerRasterRecord | null> {
    const match = this.records.find((record) => record.productId === uniqueness.productId && record.productType === uniqueness.productType);
    return Promise.resolve(match ?? null);
  }
}
