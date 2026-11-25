/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import type { Logger } from '@map-colonies/js-logger';
import { PersistedBasemapSchema } from '@map-colonies/app-shared';
import { findLayerConflicts } from './basemapInvariants';
import type { PersistedBasemap } from './types';

const IdGuessSchema = z.object({ id: z.string() }).passthrough();

export interface SplitPersistedBasemaps {
  valid: PersistedBasemap[];
  invalidRaw: unknown[];
  invalidIds: ReadonlySet<string>;
}

export function splitPersistedBasemaps(raw: unknown[], logger: Logger): SplitPersistedBasemaps {
  const valid: PersistedBasemap[] = [];
  const invalidRaw: unknown[] = [];
  const invalidIds = new Set<string>();

  raw.forEach((entry, index) => {
    const result = PersistedBasemapSchema.safeParse(entry);
    const layerConflicts = result.success ? findLayerConflicts(result.data.layers) : [];
    if (result.success && layerConflicts.length === 0) {
      valid.push(result.data);
      return;
    }

    invalidRaw.push(entry);
    const idGuess = IdGuessSchema.safeParse(entry);
    const basemapId = idGuess.success ? idGuess.data.id : undefined;
    if (basemapId !== undefined) {
      invalidIds.add(basemapId);
    }
    logger.warn({
      msg: 'skipping invalid persisted basemap entry',
      basemapId: basemapId ?? `<unresolvable, array index ${index}>`,
      issues: result.success ? layerConflicts : result.error.issues,
    });
  });

  return { valid, invalidRaw, invalidIds };
}
