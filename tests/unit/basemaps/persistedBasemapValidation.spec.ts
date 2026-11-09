import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@map-colonies/js-logger';
import { Domain, ProductType, SourceType } from '@map-colonies/types';
import { splitPersistedBasemaps } from '@src/basemaps/models/persistedBasemapValidation';
import type { IPersistedBasemap } from '@src/basemaps/models/types';

function validEntry(id: string): IPersistedBasemap {
  return {
    id,
    name: `Basemap ${id}`,
    thumbnail: { url: 'https://example.com/thumb.png', width: 128, height: 128 },
    isCurrent: false,
    isForPreview: false,
    layers: [
      {
        id: 'layer-1',
        order: 0,
        opacity: 1,
        source: { type: SourceType.CATALOG_RESOURCE, domain: Domain.RASTER, uniqueness: { productId: '1', productType: ProductType.ORTHOPHOTO } },
      },
    ],
  };
}

function fakeLogger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn() } as unknown as Logger;
}

describe('splitPersistedBasemaps', () => {
  it('keeps every entry valid, in order', () => {
    const raw = [validEntry('a'), validEntry('b')];

    const { valid, invalidRaw, invalidIds } = splitPersistedBasemaps(raw, fakeLogger());

    expect(valid.map((basemap) => basemap.id)).toEqual(['a', 'b']);
    expect(invalidRaw).toHaveLength(0);
    expect(invalidIds.size).toBe(0);
  });

  it('drops an entry with a structurally invalid field from `valid`, keeps it in `invalidRaw`, and logs its id', () => {
    const bad = { ...validEntry('bad-id'), name: 123 };
    const raw = [validEntry('good'), bad];
    const logger = fakeLogger();

    const { valid, invalidRaw, invalidIds } = splitPersistedBasemaps(raw, logger);

    expect(valid.map((basemap) => basemap.id)).toEqual(['good']);
    expect(invalidRaw).toEqual([bad]);
    expect(invalidIds.has('bad-id')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ msg: 'skipping invalid persisted basemap entry', basemapId: 'bad-id' }));
    const [[loggedArg]] = vi.mocked(logger.warn).mock.calls as [[{ issues: unknown[] }]];
    expect(Array.isArray(loggedArg.issues)).toBe(true);
  });

  it('still logs a resolvable index placeholder when even the id cannot be read', () => {
    const bad = { not: 'a basemap at all' };
    const logger = fakeLogger();

    const { valid, invalidRaw, invalidIds } = splitPersistedBasemaps([bad], logger);

    expect(valid).toHaveLength(0);
    expect(invalidRaw).toEqual([bad]);
    expect(invalidIds.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ basemapId: '<unresolvable, array index 0>' }));
  });

  it('preserves multiple invalid entries independently, each logged once', () => {
    const badOne = { id: 'bad-one' };
    const badTwo = { id: 'bad-two' };
    const logger = fakeLogger();

    const { valid, invalidRaw, invalidIds } = splitPersistedBasemaps([validEntry('ok'), badOne, badTwo], logger);

    expect(valid.map((basemap) => basemap.id)).toEqual(['ok']);
    expect(invalidRaw).toEqual([badOne, badTwo]);
    expect(invalidIds).toEqual(new Set(['bad-one', 'bad-two']));
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
