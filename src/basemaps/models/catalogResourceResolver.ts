import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { ProductType, type Capability } from '@map-colonies/types';
import { SERVICES } from '@common/constants';
import { RASTER_CATALOG_CLIENT, type IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT, type IMapServerCapabilitiesClient } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import type { LayerRasterRecordModelType } from './catalogTypes';
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
// shared ProductType spans all domains (raster/DEM/3D/vector) - this allowlist must stay an explicit
// raster-only subset, not Object.values(ProductType), or non-raster product types would resolve here.
const RASTER_PRODUCT_TYPES = new Set<string>([
  ProductType.ORTHOPHOTO,
  ProductType.ORTHOPHOTO_HISTORY,
  ProductType.ORTHOPHOTO_BEST,
  ProductType.RASTER_MAP,
  ProductType.RASTER_MAP_BEST,
  ProductType.RASTER_AID,
  ProductType.RASTER_AID_BEST,
  ProductType.RASTER_VECTOR,
  ProductType.RASTER_VECTOR_BEST,
]);

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
    let capabilitiesPromise: Promise<Capability[]> | undefined;
    const getCapabilities = async (): Promise<Capability[]> => {
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
    getCapabilities: () => Promise<Capability[]>
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
    const capabilities = (await getCapabilities()).find((capability) => capability.id === linkName);
    if (capabilities === undefined) {
      this.logger.warn({ msg: 'no MapProxy capability matches the catalog record - returned as unresolved', linkName, ...source.uniqueness });
      return unresolved;
    }
    return { ...reference, status: Status.RESOLVED, layer, capabilities };
  }
}

export type SourceResolver = (source: IBasemapLayerSourceInput) => Promise<IBasemapLayerSourceOutput>;
