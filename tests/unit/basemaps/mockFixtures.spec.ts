import { describe, it, expect } from 'vitest';
import { PersistedBasemapSchema } from '@map-colonies/app-shared';
import { validateBasemapWriteInput } from '@src/basemaps/models/basemapValidation';
import { findCollectionConflicts } from '@src/basemaps/models/basemapInvariants';
import { MOCK_CATALOG_PRODUCT, MOCK_PERSISTED_BASEMAPS } from '@src/basemaps/mock/mockBasemaps';

describe('mock-mode fixtures', () => {
  it.each(MOCK_PERSISTED_BASEMAPS.map((basemap) => [basemap.id, basemap] as const))(
    'persisted basemap %s satisfies the persisted schema and the write-time business rules',
    (_id, basemap) => {
      expect(PersistedBasemapSchema.safeParse(basemap).success).toBe(true);

      const { id, ...writeInput } = basemap;

      expect(id.length).toBeGreaterThan(0);
      expect(() => validateBasemapWriteInput(writeInput)).not.toThrow();
    }
  );

  it('has unique basemap ids and a single owner per role', () => {
    expect(findCollectionConflicts(MOCK_PERSISTED_BASEMAPS)).toEqual([]);
  });

  it('references the mock catalog product from at least one layer, and includes an unknown product to exercise UNRESOLVED', () => {
    const productIds = MOCK_PERSISTED_BASEMAPS.flatMap((basemap) =>
      basemap.layers.flatMap(({ source }) => (source.type === 'CATALOG_RESOURCE' ? [source.uniqueness.productId] : []))
    );

    expect(productIds).toContain(MOCK_CATALOG_PRODUCT.productId);
    expect(productIds.some((productId) => productId !== MOCK_CATALOG_PRODUCT.productId)).toBe(true);
  });
});
