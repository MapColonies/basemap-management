import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { RASTER_CATALOG_CLIENT, type IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT, type IMapServerCapabilitiesClient } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import { ProductType, type CapabilityModelType, type LayerRasterRecordModelType } from './catalogTypes';
import {
  SourceType,
  Status,
  type IBasemapLayerSourceInput,
  type IBasemapLayerSourceOutput,
  type ICatalogResourceLayerSource,
  type IRasterUniqueness,
  type IResolvableRasterUniqueness,
  type IUnresolvedCatalogResourceLayerSource,
} from './types';

const WMTS_PROTOCOL = 'WMTS';
const RASTER_PRODUCT_TYPES = new Set<string>(Object.values(ProductType));

function toResolvableUniqueness({ productId, productType }: IRasterUniqueness): IResolvableRasterUniqueness | undefined {
  if (typeof productId !== 'string' || productId.length === 0 || productType === undefined || !RASTER_PRODUCT_TYPES.has(productType)) {
    return undefined;
  }
  return { productId, productType };
}

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
        this.logger.warn({ msg: 'MapProxy capabilities unavailable - catalog layers will be returned as unresolved', err: error });
        return [];
      });
      return capabilitiesPromise;
    };

    return async (source) => {
      switch (source.type) {
        case SourceType.CATALOG_RESOURCE:
          return this.resolveCatalogResource(source, getCapabilities);
        case SourceType.EXTERNAL:
          return { type: SourceType.EXTERNAL, status: Status.RESOLVED, details: source.details };
        default:
          throw new Error(`persisted layer source has an unsupported type "${String((source as { type?: unknown }).type)}"`);
      }
    };
  }

  private async resolveCatalogResource(
    source: ICatalogResourceLayerSource,
    getCapabilities: () => Promise<CapabilityModelType[]>
  ): Promise<IBasemapLayerSourceOutput> {
    const reference = { type: SourceType.CATALOG_RESOURCE, domain: source.domain, uniqueness: source.uniqueness } as const;
    const unresolved: IUnresolvedCatalogResourceLayerSource = { ...reference, status: Status.UNRESOLVED, layer: null, capabilities: null };

    const uniqueness = toResolvableUniqueness(source.uniqueness);
    if (uniqueness === undefined) {
      this.logger.warn({ msg: 'catalog reference is incomplete or has an unknown productType - returned as unresolved', ...source.uniqueness });
      return unresolved;
    }

    const layer = await this.rasterCatalogClient.resolveLayer(source.domain, uniqueness);
    if (layer === null) {
      return unresolved;
    }
    const linkName = findWmtsLinkName(layer);
    if (linkName === undefined) {
      this.logger.warn({ msg: 'catalog record has no WMTS link - returned as unresolved', ...source.uniqueness });
      return unresolved;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- CapabilityModelType derives from the shared zod-inferred @map-colonies/types contract, which type-aware lint can't fully resolve here; tsc checks it fine.
    const capabilities = (await getCapabilities()).find((capability) => capability.id === linkName);
    if (capabilities === undefined) {
      this.logger.warn({ msg: 'no MapProxy capability matches the catalog record - returned as unresolved', linkName, ...source.uniqueness });
      return unresolved;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- same CapabilityModelType resolution limitation as above
    return { ...reference, status: Status.RESOLVED, layer, capabilities };
  }
}

export type SourceResolver = (source: IBasemapLayerSourceInput) => Promise<IBasemapLayerSourceOutput>;
