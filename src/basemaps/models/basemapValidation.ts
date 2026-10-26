import { ValidationError } from '@common/errors';
import { ProductType } from './catalogTypes';
import { PROTOCOLS, SourceTypeInput } from './types';
import type { IBasemapLayerInput, IBasemapWriteInput } from './types';

const MIN_OPACITY = 0;
const MAX_OPACITY = 1;
const VALID_PRODUCT_TYPES = new Set<string>(Object.values(ProductType));

function validateLayer(layer: IBasemapLayerInput): void {
  if (layer.opacity < MIN_OPACITY || layer.opacity > MAX_OPACITY) {
    throw new ValidationError(`layer "${layer.id}" has an invalid opacity (${layer.opacity}) - must be between 0 and 1`);
  }

  switch (layer.source.type) {
    case SourceTypeInput.CATALOG_RESOURCE:
      if (layer.source.uniqueness.productId.length === 0) {
        throw new ValidationError(`layer "${layer.id}" is missing uniqueness.productId`);
      }
      if (!VALID_PRODUCT_TYPES.has(layer.source.uniqueness.productType)) {
        throw new ValidationError(`layer "${layer.id}" has an unknown uniqueness.productType "${layer.source.uniqueness.productType}"`);
      }
      break;
    case SourceTypeInput.EXTERNAL:
      if (!PROTOCOLS.includes(layer.source.details.protocol)) {
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
