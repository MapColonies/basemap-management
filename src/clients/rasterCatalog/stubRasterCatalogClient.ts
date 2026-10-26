import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import type { Domain, LayerRasterRecordModelType } from '@src/basemaps/models/catalogTypes';
import type { IRasterUniqueness } from '@src/basemaps/models/types';
import type { IRasterCatalogClient } from './rasterCatalogClient';

@injectable()
export class StubRasterCatalogClient implements IRasterCatalogClient {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation, nothing to await
  public async resolveLayer(domain: Domain.RASTER, uniqueness: IRasterUniqueness): Promise<LayerRasterRecordModelType | null> {
    this.logger.warn({
      msg: 'StubRasterCatalogClient used - real Raster Catalog resolution is unavailable, resolution always fails',
      domain,
      productId: uniqueness.productId,
      productType: uniqueness.productType,
    });
    return null;
  }
}
