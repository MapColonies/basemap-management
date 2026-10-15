import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import type { ProductType } from '@map-colonies/types';
import { SERVICES } from '@common/constants';
import type { IRasterCatalogClient } from './rasterCatalogClient';

@injectable()
export class StubRasterCatalogClient implements IRasterCatalogClient {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation, nothing to await
  public async resolve(productId: string, productType: ProductType): Promise<unknown> {
    this.logger.warn({
      msg: 'StubRasterCatalogClient used - real Raster Catalog resolution is unavailable, resolution always fails',
      productId,
      productType,
    });
    return undefined;
  }
}
