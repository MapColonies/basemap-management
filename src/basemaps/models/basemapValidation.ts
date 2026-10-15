import { ProductType } from '@map-colonies/types';
import { ValidationError } from '@common/errors';
import { PROTOCOLS } from './types';
import type { IBasemapLayerInput, IBasemapWriteInput } from './types';

const MIN_OPACITY = 0;
const MAX_OPACITY = 1;
const VALID_PRODUCT_TYPES = new Set<string>(Object.values(ProductType));

function validateLayer(layer: IBasemapLayerInput): void {
  if (layer.opacity < MIN_OPACITY || layer.opacity > MAX_OPACITY) {
    throw new ValidationError(`layer "${layer.id}" has an invalid opacity (${layer.opacity}) - must be between 0 and 1`);
  }

  switch (layer.source.type) {
    case 'RASTER_RESOURCE':
      if (layer.source.productId.length === 0) {
        throw new ValidationError(`layer "${layer.id}" is missing productId`);
      }
      if (!VALID_PRODUCT_TYPES.has(layer.source.productType)) {
        throw new ValidationError(`layer "${layer.id}" has an unknown productType "${layer.source.productType}"`);
      }
      break;
    case 'EXTERNAL':
      if (!(PROTOCOLS as readonly string[]).includes(layer.source.details.protocol)) {
        throw new ValidationError(`layer "${layer.id}" has an unknown protocol "${layer.source.details.protocol}"`);
      }
      if (layer.source.details.name.trim().length === 0) {
        throw new ValidationError(`layer "${layer.id}" is missing details.name`);
      }
      if (layer.source.details.url.length === 0) {
        throw new ValidationError(`layer "${layer.id}" is missing details.url`);
      }
      break;
    /* istanbul ignore next */
    default:
      // switch-exhaustiveness-check keeps this safe against future source types.
      throw new ValidationError(`layer "${layer.id}" has an unknown source type`);
  }
}

/**
 * Validates a Basemap write input (POST/PUT body) before it is ever handed to a manager/persistence
 * layer. Throws {@link ValidationError} (HTTP 400) on the first problem found.
 */
export function validateBasemapWriteInput(input: IBasemapWriteInput): void {
  if (input.name.trim().length === 0) {
    throw new ValidationError('name must not be empty');
  }

  if (input.thumbnail.url.trim().length === 0) {
    throw new ValidationError('thumbnail.url must not be empty - upload a thumbnail via POST /basemaps/thumbnails first');
  }

  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const layer of input.layers) {
    if (seenIds.has(layer.id)) {
      throw new ValidationError(`duplicate layer id "${layer.id}"`);
    }
    seenIds.add(layer.id);

    if (seenOrders.has(layer.order)) {
      throw new ValidationError(`duplicate layer order "${layer.order}"`);
    }
    seenOrders.add(layer.order);

    validateLayer(layer);
  }
}
