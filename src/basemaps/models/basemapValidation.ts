import { SourceType, BasemapWriteInputSchema } from '@map-colonies/app-shared';
import { ValidationError } from '@common/errors';
import { PROTOCOLS } from './types';
import type { BasemapLayerInput, BasemapWriteInput } from './types';

function validateBusinessRules(input: BasemapWriteInput): void {
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

    if (layer.source.type === SourceType.EXTERNAL && !PROTOCOLS.includes(layer.source.details.protocol)) {
      throw new ValidationError(`layer "${layer.id}" has an unknown protocol "${layer.source.details.protocol}"`);
    }
  }
}

function messageFor(layer: BasemapLayerInput | undefined, issue: { path: (string | number)[]; message: string }): string {
  if (layer === undefined) {
    const fieldPath = issue.path.join('.');
    return fieldPath.length > 0 ? `${fieldPath}: ${issue.message}` : issue.message;
  }
  const [, , field, ...rest] = issue.path;
  const fieldPath = [field, ...rest].join('.');
  return `layer "${layer.id}" ${fieldPath}: ${issue.message}`;
}

export function validateBasemapWriteInput(input: BasemapWriteInput): void {
  const result = BasemapWriteInputSchema.safeParse(input);
  if (!result.success) {
    const [issue] = result.error.issues;
    /* istanbul ignore next -- zod guarantees at least one issue on failure */
    if (issue === undefined) {
      throw new ValidationError('invalid basemap input');
    }
    const layer = issue.path[0] === 'layers' && typeof issue.path[1] === 'number' ? input.layers[issue.path[1]] : undefined;
    throw new ValidationError(messageFor(layer, issue));
  }

  validateBusinessRules(input);
}
