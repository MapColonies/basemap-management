import { getOtelMixin } from '@map-colonies/tracing-utils';
import { trace } from '@opentelemetry/api';
import { Registry } from 'prom-client';
import type { DependencyContainer } from 'tsyringe/dist/typings/types';
import { jsLogger } from '@map-colonies/js-logger';
import { type InjectionObject, registerDependencies } from '@common/dependencyRegistration';
import { SERVICES, SERVICE_NAME } from '@common/constants';
import { getTracing } from '@common/tracing';
import { getBasemapManagementEnv } from '@common/env';
import { CONFIG_SERVER_CLIENT } from '@src/clients/configServer/configServerClient';
import { HttpConfigServerClient } from '@src/clients/configServer/httpConfigServerClient';
import { RASTER_CATALOG_CLIENT } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { HttpRasterCatalogClient } from '@src/clients/rasterCatalog/httpRasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import { HttpMapServerCapabilitiesClient } from '@src/clients/mapServer/httpMapServerCapabilitiesClient';
import { basemapsRouterFactory, BASEMAPS_ROUTER_SYMBOL } from './basemaps/routes/basemapsRouter';
import { getConfig } from './common/config';

interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const configInstance = getConfig();

  const loggerConfig = configInstance.get('telemetry.logger');

  const logger = await jsLogger({ ...loggerConfig, mixin: getOtelMixin() });

  const tracer = trace.getTracer(SERVICE_NAME);
  const metricsRegistry = new Registry();
  configInstance.initializeMetrics(metricsRegistry);

  const basemapManagementEnv = getBasemapManagementEnv(configInstance);

  let dataSourceDependencies: InjectionObject<unknown>[] = [{ token: CONFIG_SERVER_CLIENT, provider: { useClass: HttpConfigServerClient } }];
  if (basemapManagementEnv.mockData) {
    logger.warn({
      msg: 'BASEMAP_MOCK_DATA=true - MOCK MODE: basemaps are served from in-memory fixtures; Raster Catalog (PyCSW) records and MapProxy capabilities are still fetched from the configured services. Writes are not persisted. NEVER use in production.',
    });
    const { createMockDataSourceDependencies } = await import('./basemaps/mock/index.js');
    dataSourceDependencies = createMockDataSourceDependencies();
  }

  const dependencies: InjectionObject<unknown>[] = [
    { token: SERVICES.CONFIG, provider: { useValue: configInstance } },
    { token: SERVICES.LOGGER, provider: { useValue: logger } },
    { token: SERVICES.TRACER, provider: { useValue: tracer } },
    { token: SERVICES.METRICS, provider: { useValue: metricsRegistry } },
    { token: SERVICES.BASEMAP_MANAGEMENT_ENV, provider: { useValue: basemapManagementEnv } },
    ...dataSourceDependencies,
    { token: RASTER_CATALOG_CLIENT, provider: { useClass: HttpRasterCatalogClient } },
    { token: MAP_SERVER_CAPABILITIES_CLIENT, provider: { useClass: HttpMapServerCapabilitiesClient } },
    { token: BASEMAPS_ROUTER_SYMBOL, provider: { useFactory: basemapsRouterFactory } },
    {
      token: 'onSignal',
      provider: {
        useValue: async (): Promise<void> => {
          await Promise.all([getTracing().stop()]);
        },
      },
    },
  ];

  return Promise.resolve(registerDependencies(dependencies, options?.override, options?.useChild));
};

export { registerExternalValues };
export type { RegisterOptions };
