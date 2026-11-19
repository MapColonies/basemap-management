import { describe, it, expect } from 'vitest';
import { PersistedBasemapSchema } from '@map-colonies/app-shared';
import { CapabilityWMTSSchema } from '@map-colonies/wmts-client';
import { validateBasemapWriteInput } from '@src/basemaps/models/basemapValidation';
import { assertSingleOwnerPerRole } from '@src/basemaps/models/defaultRolePolicy';
import { LayerRasterRecordSchema } from '@src/basemaps/models/catalogTypes';
import { MOCK_PERSISTED_BASEMAPS } from '@src/basemaps/mock/mockBasemaps';
import { MOCK_RASTER_RECORD } from '@src/basemaps/mock/mockRasterRecord';
import { MOCK_CAPABILITIES } from '@src/basemaps/mock/mockCapabilities';

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
    const ids = MOCK_PERSISTED_BASEMAPS.map((basemap) => basemap.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(() => assertSingleOwnerPerRole(MOCK_PERSISTED_BASEMAPS)).not.toThrow();
  });

  it('every capability satisfies CapabilityWMTSSchema and carries no credentials', () => {
    for (const capability of MOCK_CAPABILITIES) {
      expect(CapabilityWMTSSchema.safeParse(capability).success).toBe(true);
    }

    expect(JSON.stringify(MOCK_CAPABILITIES)).not.toMatch(/token=|eyJ|password|secret|api[_-]?key/i);
  });

  it('the raster record is a valid catalog record whose WMTS link matches a capability', () => {
    expect(LayerRasterRecordSchema.safeParse(MOCK_RASTER_RECORD).success).toBe(true);

    const wmtsLink = (MOCK_RASTER_RECORD.links as { protocol: string; name: string }[]).find((link) => link.protocol === 'WMTS');

    expect(MOCK_CAPABILITIES.map((capability) => capability.id)).toContain(wmtsLink?.name);
  });

  it('references the raster record from at least one layer, and includes an unknown product to exercise UNRESOLVED', () => {
    const productIds = MOCK_PERSISTED_BASEMAPS.flatMap((basemap) =>
      basemap.layers.flatMap(({ source }) => (source.type === 'CATALOG_RESOURCE' ? [source.uniqueness.productId] : []))
    );

    expect(productIds).toContain(MOCK_RASTER_RECORD.productId);
    expect(productIds.some((productId) => productId !== MOCK_RASTER_RECORD.productId)).toBe(true);
  });
});
