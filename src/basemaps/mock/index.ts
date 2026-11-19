import type { InjectionObject } from '@common/dependencyRegistration';
import { CONFIG_SERVER_CLIENT } from '@src/clients/configServer/configServerClient';
import { InMemoryConfigServerClient } from '@src/clients/configServer/inMemoryConfigServerClient';
import { RASTER_CATALOG_CLIENT } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { FixtureRasterCatalogClient } from '@src/clients/rasterCatalog/fixtureRasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import { FixtureMapServerCapabilitiesClient } from '@src/clients/mapServer/fixtureMapServerCapabilitiesClient';
import { MOCK_PERSISTED_BASEMAPS } from './mockBasemaps';
import { MOCK_RASTER_RECORD } from './mockRasterRecord';
import { MOCK_CAPABILITIES } from './mockCapabilities';

export function createMockDataSourceDependencies(): InjectionObject<unknown>[] {
  return [
    { token: CONFIG_SERVER_CLIENT, provider: { useValue: new InMemoryConfigServerClient({ basemaps: MOCK_PERSISTED_BASEMAPS }) } },
    { token: RASTER_CATALOG_CLIENT, provider: { useValue: new FixtureRasterCatalogClient([MOCK_RASTER_RECORD]) } },
    { token: MAP_SERVER_CAPABILITIES_CLIENT, provider: { useValue: new FixtureMapServerCapabilitiesClient(MOCK_CAPABILITIES) } },
  ];
}
