/**
 * This service's own domain-specific settings, read directly from `process.env`.
 *
 * Deliberately NOT routed through `@map-colonies/config`/`commonBoilerplateV3` (A.10): that shared
 * schema only describes generic boilerplate settings (server port, telemetry, OpenAPI docs) and has
 * no confirmed process for extending it with a service's own domain settings yet. Forcing these
 * through it would mean either inventing an unconfirmed schema extension or silently bypassing
 * validation - both worse than being explicit that this is a temporary, intentional exception.
 * Once such a process exists, these belong in `config/default.json` like the rest of the
 * boilerplate's settings.
 */

type RasterCatalogMode = 'stub' | 'http';

interface IBasemapManagementEnv {
  configServer: {
    /**
     * Origin only (e.g. `http://config-server`) - must NOT include `/api/config`. This service is the
     * single place that composes the path (see `clients/configServer/httpConfigServerClient.ts`), to
     * avoid the ambiguity seen in `lookup-tables`' Helm chart, where the global `configManagment.url`
     * value itself already bakes in `/api/config` while the application code appends it again.
     */
    url: string;
    configName: string;
    /** config-server schema id for the "basemaps" document. Not yet registered anywhere - see README. */
    schemaId: string;
  };
  dataService: {
    /** Placeholder: the future binary-persistence data-service does not exist yet (A.12) - unused until it does. */
    url: string;
  };
  rasterCatalog: {
    /** Placeholder: the real Raster pycsw Catalog HTTP contract is not confirmed yet - unused while `mode` is `'stub'`. */
    url: string;
    mode: RasterCatalogMode;
  };
  uploadLimits: {
    thumbnailMaxSizeBytes: number;
    importPackageMaxSizeBytes: number;
  };
}

const DEFAULT_CONFIG_MANAGEMENT_URL = 'http://localhost:8080';
const DEFAULT_CONFIG_BASEMAPS_NAME = 'basemaps';
const DEFAULT_CONFIG_BASEMAPS_SCHEMA_ID = 'https://mapcolonies.com/basemaps/v1';
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const DEFAULT_THUMBNAIL_MAX_SIZE_MEGABYTES = 2;
const DEFAULT_IMPORT_PACKAGE_MAX_SIZE_MEGABYTES = 10;
const RASTER_CATALOG_MODES: readonly RasterCatalogMode[] = ['stub', 'http'];

function parseRasterCatalogMode(value: string | undefined): RasterCatalogMode {
  if (value === undefined) {
    return 'stub';
  }
  if (!(RASTER_CATALOG_MODES as readonly string[]).includes(value)) {
    throw new Error(`invalid RASTER_CATALOG_MODE "${value}" - expected one of: ${RASTER_CATALOG_MODES.join(', ')}`);
  }
  return value as RasterCatalogMode;
}

function parseByteSize(value: string | undefined, defaultBytes: number): number {
  if (value === undefined) {
    return defaultBytes;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid byte-size environment value "${value}"`);
  }
  return parsed;
}

function getBasemapManagementEnv(): IBasemapManagementEnv {
  return {
    configServer: {
      url: process.env.CONFIG_MANAGEMENT_URL ?? DEFAULT_CONFIG_MANAGEMENT_URL,
      configName: process.env.CONFIG_BASEMAPS_NAME ?? DEFAULT_CONFIG_BASEMAPS_NAME,
      schemaId: process.env.CONFIG_BASEMAPS_SCHEMA_ID ?? DEFAULT_CONFIG_BASEMAPS_SCHEMA_ID,
    },
    dataService: {
      url: process.env.DATA_SERVICE_URL ?? '',
    },
    rasterCatalog: {
      url: process.env.RASTER_CATALOG_URL ?? '',
      mode: parseRasterCatalogMode(process.env.RASTER_CATALOG_MODE),
    },
    uploadLimits: {
      thumbnailMaxSizeBytes: parseByteSize(process.env.THUMBNAIL_MAX_SIZE_BYTES, DEFAULT_THUMBNAIL_MAX_SIZE_MEGABYTES * BYTES_PER_MEGABYTE),
      importPackageMaxSizeBytes: parseByteSize(
        process.env.IMPORT_PACKAGE_MAX_SIZE_BYTES,
        DEFAULT_IMPORT_PACKAGE_MAX_SIZE_MEGABYTES * BYTES_PER_MEGABYTE
      ),
    },
  };
}

export { getBasemapManagementEnv };
export type { IBasemapManagementEnv, RasterCatalogMode };
