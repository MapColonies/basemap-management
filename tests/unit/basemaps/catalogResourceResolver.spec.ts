import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { CatalogResourceResolver } from '@src/basemaps/models/catalogResourceResolver';
import { Domain, ProductType, type CapabilityModelType, type LayerRasterRecordModelType } from '@src/basemaps/models/catalogTypes';
import { SourceTypeInput, SourceTypeOutput, type ICatalogResourceLayerSource, type IExternalLayerSourceInput } from '@src/basemaps/models/types';
import type { IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import type { IMapServerCapabilitiesClient } from '@src/clients/mapServer/mapServerCapabilitiesClient';

const LINK_NAME = '12345-Orthophoto';
const RECORD: LayerRasterRecordModelType = {
  id: 'record-1',
  productId: '12345',
  productType: ProductType.ORTHOPHOTO,
  links: [
    { protocol: 'WMS', name: 'wms-name', url: 'https://mapproxy/wms' },
    { protocol: 'WMTS', name: LINK_NAME, url: 'https://mapproxy/wmts' },
  ],
};
const CAPABILITY: CapabilityModelType = { id: LINK_NAME, format: ['image/jpeg'] };
const CATALOG_SOURCE: ICatalogResourceLayerSource = {
  type: SourceTypeInput.CATALOG_RESOURCE,
  domain: Domain.RASTER,
  uniqueness: { productId: '12345', productType: ProductType.ORTHOPHOTO },
};
const UNRESOLVED = { type: SourceTypeOutput.UNRESOLVED_CATALOG_RESOURCE, domain: Domain.RASTER, uniqueness: CATALOG_SOURCE.uniqueness };

describe('CatalogResourceResolver', () => {
  let rasterCatalogClient: { resolveLayer: ReturnType<typeof vi.fn<IRasterCatalogClient['resolveLayer']>> };
  let mapServerClient: { getCapabilities: ReturnType<typeof vi.fn<IMapServerCapabilitiesClient['getCapabilities']>> };
  let resolver: CatalogResourceResolver;

  beforeEach(async () => {
    rasterCatalogClient = { resolveLayer: vi.fn<IRasterCatalogClient['resolveLayer']>().mockResolvedValue(RECORD) };
    mapServerClient = { getCapabilities: vi.fn<IMapServerCapabilitiesClient['getCapabilities']>().mockResolvedValue([CAPABILITY]) };
    resolver = new CatalogResourceResolver(rasterCatalogClient, mapServerClient, await jsLogger({ enabled: false }));
  });

  it('resolves a catalog resource into its record and the capability matching its WMTS link name', async () => {
    await expect(resolver.createScope()(CATALOG_SOURCE)).resolves.toEqual({
      type: SourceTypeOutput.RESOLVED_CATALOG_RESOURCE,
      domain: Domain.RASTER,
      layer: RECORD,
      capabilities: CAPABILITY,
    });
    expect(rasterCatalogClient.resolveLayer).toHaveBeenCalledWith(Domain.RASTER, CATALOG_SOURCE.uniqueness);
  });

  it('returns UNRESOLVED (keeping the original uniqueness) when the record is not found, without fetching capabilities', async () => {
    rasterCatalogClient.resolveLayer.mockResolvedValue(null);

    await expect(resolver.createScope()(CATALOG_SOURCE)).resolves.toEqual(UNRESOLVED);
    expect(mapServerClient.getCapabilities).not.toHaveBeenCalled();
  });

  it('returns UNRESOLVED when the record has no WMTS link', async () => {
    rasterCatalogClient.resolveLayer.mockResolvedValue({ ...RECORD, links: [{ protocol: 'WMS', name: 'x', url: 'u' }] });

    await expect(resolver.createScope()(CATALOG_SOURCE)).resolves.toEqual(UNRESOLVED);
  });

  it('returns UNRESOLVED when no MapProxy capability matches - never a resolved source without capabilities', async () => {
    mapServerClient.getCapabilities.mockResolvedValue([{ id: 'some-other-layer' }]);

    await expect(resolver.createScope()(CATALOG_SOURCE)).resolves.toEqual(UNRESOLVED);
  });

  it('returns UNRESOLVED when MapProxy is unreachable', async () => {
    mapServerClient.getCapabilities.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(resolver.createScope()(CATALOG_SOURCE)).resolves.toEqual(UNRESOLVED);
  });

  it('fetches the capabilities document at most once per scope', async () => {
    const resolve = resolver.createScope();

    await Promise.all([resolve(CATALOG_SOURCE), resolve(CATALOG_SOURCE), resolve(CATALOG_SOURCE)]);

    expect(mapServerClient.getCapabilities).toHaveBeenCalledTimes(1);
  });

  it('returns an external source with its details unchanged, without any catalog or MapProxy lookup', async () => {
    const external: IExternalLayerSourceInput = {
      type: SourceTypeInput.EXTERNAL,
      details: { protocol: 'WMTS', name: 'n', url: 'https://example.com', layer: 'ortho' },
    };

    await expect(resolver.createScope()(external)).resolves.toEqual({ type: SourceTypeOutput.EXTERNAL, details: external.details });
    expect(rasterCatalogClient.resolveLayer).not.toHaveBeenCalled();
    expect(mapServerClient.getCapabilities).not.toHaveBeenCalled();
  });
  it('fails loudly on a persisted source of an unknown (e.g. legacy RASTER_RESOURCE) type instead of mislabelling it', async () => {
    const legacy = { type: 'RASTER_RESOURCE', productId: '12345', productType: ProductType.ORTHOPHOTO } as unknown as ICatalogResourceLayerSource;

    await expect(resolver.createScope()(legacy)).rejects.toThrow(/unsupported type "RASTER_RESOURCE"/);
  });
});
