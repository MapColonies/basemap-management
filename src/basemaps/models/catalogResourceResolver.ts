import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { RASTER_CATALOG_CLIENT, type IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT, type IMapServerCapabilitiesClient } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import type { CapabilityModelType, LayerRasterRecordModelType } from './catalogTypes';
import {
  SourceTypeInput,
  SourceTypeOutput,
  type IBasemapLayerSourceInput,
  type IBasemapLayerSourceOutput,
  type ICatalogResourceLayerSource,
} from './types';

const WMTS_PROTOCOL = 'WMTS';

function findWmtsLinkName(layer: LayerRasterRecordModelType): string | undefined {
  const name = layer.links?.find((link) => link.protocol === WMTS_PROTOCOL)?.name;
  return name ?? undefined;
}

@injectable()
export class CatalogResourceResolver {
  public constructor(
    @inject(RASTER_CATALOG_CLIENT) private readonly rasterCatalogClient: IRasterCatalogClient,
    @inject(MAP_SERVER_CAPABILITIES_CLIENT) private readonly mapServerClient: IMapServerCapabilitiesClient,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {}

  public createScope(): SourceResolver {
    let capabilitiesPromise: Promise<CapabilityModelType[]> | undefined;
    const getCapabilities = async (): Promise<CapabilityModelType[]> => {
      capabilitiesPromise ??= this.mapServerClient.getCapabilities().catch((error: unknown) => {
        // MapProxy unreachable: every catalog layer resolves as UNRESOLVED (design §A.12) - no fallback.
        this.logger.warn({ msg: 'MapProxy capabilities unavailable - catalog layers will be returned as unresolved', err: error });
        return [];
      });
      return capabilitiesPromise;
    };

    return async (source) => {
      switch (source.type) {
        case SourceTypeInput.CATALOG_RESOURCE:
          return this.resolveCatalogResource(source, getCapabilities);
        case SourceTypeInput.EXTERNAL:
          return { type: SourceTypeOutput.EXTERNAL, details: source.details };
        default:
          throw new Error(`persisted layer source has an unsupported type "${String((source as { type?: unknown }).type)}"`);
      }
    };
  }

  private async resolveCatalogResource(
    source: ICatalogResourceLayerSource,
    getCapabilities: () => Promise<CapabilityModelType[]>
  ): Promise<IBasemapLayerSourceOutput> {
    const unresolved: IBasemapLayerSourceOutput = {
      type: SourceTypeOutput.UNRESOLVED_CATALOG_RESOURCE,
      domain: source.domain,
      uniqueness: source.uniqueness,
    };

    const layer = await this.rasterCatalogClient.resolveLayer(source.domain, source.uniqueness);
    if (layer === null) {
      return unresolved;
    }
    const linkName = findWmtsLinkName(layer);
    if (linkName === undefined) {
      this.logger.warn({ msg: 'catalog record has no WMTS link - returned as unresolved', ...source.uniqueness });
      return unresolved;
    }
    const capabilities = (await getCapabilities()).find((capability) => capability.id === linkName);
    if (capabilities === undefined) {
      this.logger.warn({ msg: 'no MapProxy capability matches the catalog record - returned as unresolved', linkName, ...source.uniqueness });
      return unresolved;
    }
    return { type: SourceTypeOutput.RESOLVED_CATALOG_RESOURCE, domain: source.domain, layer, capabilities };
  }
}

export type SourceResolver = (source: IBasemapLayerSourceInput) => Promise<IBasemapLayerSourceOutput>;
