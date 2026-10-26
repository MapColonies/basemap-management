import { getOtelMixin } from '@map-colonies/tracing-utils';
import { trace } from '@opentelemetry/api';
import { Registry } from 'prom-client';
import type { DependencyContainer } from 'tsyringe/dist/typings/types';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { type InjectionObject, registerDependencies } from '@common/dependencyRegistration';
import { SERVICES, SERVICE_NAME } from '@common/constants';
import { getTracing } from '@common/tracing';
import { getBasemapManagementEnv } from '@common/env';
import { CONFIG_SERVER_CLIENT } from '@src/clients/configServer/configServerClient';
import { HttpConfigServerClient } from '@src/clients/configServer/httpConfigServerClient';
import { BLOB_STORAGE_CLIENT } from '@src/clients/blobStorage/blobStorageClient';
import { StubBlobStorageClient } from '@src/clients/blobStorage/stubBlobStorageClient';
import { RASTER_CATALOG_CLIENT, type IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { StubRasterCatalogClient } from '@src/clients/rasterCatalog/stubRasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import { HttpMapServerCapabilitiesClient } from '@src/clients/mapServer/httpMapServerCapabilitiesClient';
import { basemapsRouterFactory, BASEMAPS_ROUTER_SYMBOL } from './basemaps/routes/basemapsRouter';
import { getConfig } from './common/config';

interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

function rasterCatalogClientProvider(mode: 'stub' | 'http', logger: Logger): InjectionObject<IRasterCatalogClient> {
  if (mode === 'http') {
    throw new Error('RASTER_CATALOG_MODE=http is not implemented yet - no confirmed Raster Catalog contract exists. Use RASTER_CATALOG_MODE=stub.');
  }
  logger.warn({ msg: 'RasterCatalogClient running in stub mode - Raster resource resolution is unavailable' });
  return { token: RASTER_CATALOG_CLIENT, provider: { useClass: StubRasterCatalogClient } };
}

const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const configInstance = getConfig();

  const loggerConfig = configInstance.get('telemetry.logger');

  const logger = await jsLogger({ ...loggerConfig, mixin: getOtelMixin() });

  const tracer = trace.getTracer(SERVICE_NAME);
  const metricsRegistry = new Registry();
  configInstance.initializeMetrics(metricsRegistry);

  const basemapManagementEnv = getBasemapManagementEnv();

  const dependencies: InjectionObject<unknown>[] = [
    { token: SERVICES.CONFIG, provider: { useValue: configInstance } },
    { token: SERVICES.LOGGER, provider: { useValue: logger } },
    { token: SERVICES.TRACER, provider: { useValue: tracer } },
    { token: SERVICES.METRICS, provider: { useValue: metricsRegistry } },
    { token: SERVICES.BASEMAP_MANAGEMENT_ENV, provider: { useValue: basemapManagementEnv } },
    { token: CONFIG_SERVER_CLIENT, provider: { useClass: HttpConfigServerClient } },
    { token: BLOB_STORAGE_CLIENT, provider: { useClass: StubBlobStorageClient } },
    rasterCatalogClientProvider(basemapManagementEnv.rasterCatalog.mode, logger),
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

export { registerExternalValues, rasterCatalogClientProvider };
export type { RegisterOptions };
