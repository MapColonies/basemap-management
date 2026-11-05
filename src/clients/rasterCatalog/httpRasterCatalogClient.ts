import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import type { Domain } from '@map-colonies/types';
import { CswClient, type IRequestExecutor } from '@map-colonies/csw-client';
import { PycswLayerCatalogRecord } from '@map-colonies/mc-model-types';
import { SERVICES } from '@common/constants';
import { UpstreamServiceError } from '@common/errors';
import type { IBasemapManagementEnv } from '@common/env';
import type { LayerRasterRecordModelType } from '@src/basemaps/models/catalogTypes';
import type { IResolvableRasterUniqueness } from '@src/basemaps/models/types';
import type { IRasterCatalogClient } from './rasterCatalogClient';
import { mapPycswRecordToLayer } from './pycswRasterRecordMapper';

const RASTER_TYPENAME = 'mc:MCRasterRecord';
const RASTER_OUTPUT_SCHEMA = 'http://schema.mapcolonies.com/raster';
const START_INDEX = 1;
const MAX_RECORDS = 2;

const PYCSW_KEYS = PycswLayerCatalogRecord.getPyCSWMappings();

function isValidRasterRecord(record: LayerRasterRecordModelType): boolean {
  return typeof record.id === 'string' && record.id.length > 0 && Array.isArray(record.links);
}

function pickHighestVersion(records: LayerRasterRecordModelType[]): LayerRasterRecordModelType {
  return records.reduce((best, candidate) => {
    const bestVersion = Number(best.productVersion);
    const candidateVersion = Number(candidate.productVersion);
    return !Number.isNaN(candidateVersion) && (Number.isNaN(bestVersion) || candidateVersion > bestVersion) ? candidate : best;
  });
}

function extractRawRecords(response: unknown): Record<string, unknown>[] {
  const data = (response as Record<string, unknown> | undefined)?.[RASTER_TYPENAME];
  if (data === undefined) {
    return [];
  }
  return (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
}

@injectable()
export class HttpRasterCatalogClient implements IRasterCatalogClient {
  private readonly cswClient: CswClient;

  public constructor(
    @inject(SERVICES.BASEMAP_MANAGEMENT_ENV) env: IBasemapManagementEnv,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    const requestExecutor: IRequestExecutor = async (url, method, params) => {
      const { data, headers } = params as { data?: string; headers?: Record<string, string> };
      const response = await fetch(url, { method, headers, body: data });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return { data: await response.text() };
    };
    this.cswClient = new CswClient(env.rasterCatalog.url, requestExecutor);
  }

  public async resolveLayer(domain: Domain.RASTER, uniqueness: IResolvableRasterUniqueness): Promise<LayerRasterRecordModelType | null> {
    const logContext = { domain, productId: uniqueness.productId, productType: uniqueness.productType };

    const response: unknown = await this.cswClient
      .GetRecords(RASTER_OUTPUT_SCHEMA, START_INDEX, MAX_RECORDS, {
        filter: [
          { field: 'mc:productId', eq: uniqueness.productId },
          { field: 'mc:productType', eq: uniqueness.productType },
        ],
      })
      .catch((error: unknown) => {
        throw new UpstreamServiceError(`Raster PyCSW request failed: ${String(error)}`);
      });

    const rawMatches = extractRawRecords(response);
    if (rawMatches.length === 0) {
      this.logger.debug({ msg: 'no raster catalog record matched productId/productType', ...logContext });
      return null;
    }

    let records: LayerRasterRecordModelType[];
    try {
      records = rawMatches.map((raw) => mapPycswRecordToLayer(raw, PYCSW_KEYS));
    } catch (error) {
      this.logger.error({ msg: 'failed to map raster catalog record from PyCSW - returned as unresolved', err: String(error), ...logContext });
      return null;
    }

    const validRecords = records.filter(isValidRasterRecord);
    if (validRecords.length === 0) {
      this.logger.error({ msg: 'raster catalog record is missing required fields (id/links) - returned as unresolved', ...logContext });
      return null;
    }

    if (validRecords.length > 1) {
      this.logger.warn({
        msg: 'multiple raster catalog records matched productId/productType - selected the highest productVersion',
        matchedVersions: validRecords.map((record) => record.productVersion ?? null),
        ...logContext,
      });
    }

    return pickHighestVersion(validRecords);
  }
}
