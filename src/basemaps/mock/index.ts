import type { InjectionObject } from '@common/dependencyRegistration';
import { CONFIG_SERVER_CLIENT } from '@src/clients/configServer/configServerClient';
import { InMemoryConfigServerClient } from '@src/clients/configServer/inMemoryConfigServerClient';
import { MOCK_PERSISTED_BASEMAPS } from './mockBasemaps';

export function createMockDataSourceDependencies(): InjectionObject<unknown>[] {
  return [{ token: CONFIG_SERVER_CLIENT, provider: { useValue: new InMemoryConfigServerClient({ basemaps: MOCK_PERSISTED_BASEMAPS }) } }];
}
