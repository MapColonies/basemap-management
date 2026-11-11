import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type { Logger } from '@map-colonies/js-logger';
import { OGC_ImageryProtocolType, ProductType, SourceType } from '@map-colonies/types';
import type { CapabilityWMTS } from '@map-colonies/wmts-client';
import { SERVICES } from '@common/constants';
import { RASTER_CATALOG_CLIENT, type IRasterCatalogClient } from '@src/clients/rasterCatalog/rasterCatalogClient';
import { MAP_SERVER_CAPABILITIES_CLIENT, type IMapServerCapabilitiesClient } from '@src/clients/mapServer/mapServerCapabilitiesClient';
import type { LayerRasterRecordModelType } from './catalogTypes';
import {
  Status,
  type IBasemapLayerSourceInput,
  type IBasemapLayerSourceOutput,
  type ICatalogResourceLayerSource,
  type IRasterUniqueness,
  type IResolvableRasterUniqueness,
} from './types';

const WMTS_PROTOCOL = OGC_ImageryProtocolType.WMTS;
const wmtsLinkSchema = z.object({ protocol: z.literal(WMTS_PROTOCOL), name: z.string() }).passthrough();
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
  if (typeof productId !== 'string' || productId.length === 0 || typeof productType !== 'string' || !RASTER_PRODUCT_TYPES.has(productType)) {
    return undefined;
  }
  return { productId, productType: productType as ProductType };
}

function findWmtsLinkName(layer: LayerRasterRecordModelType): string | undefined {
  const links: unknown = layer.links;
  if (!Array.isArray(links)) {
    return undefined;
  }
  for (const link of links) {
    const parsed = wmtsLinkSchema.safeParse(link);
    if (parsed.success) {
      return parsed.data.name;
    }
  }
  return undefined;
}

@injectable()
export class CatalogResourceResolver {
  public constructor(
    @inject(RASTER_CATALOG_CLIENT) private readonly rasterCatalogClient: IRasterCatalogClient,
    @inject(MAP_SERVER_CAPABILITIES_CLIENT) private readonly mapServerClient: IMapServerCapabilitiesClient,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {}

  public createScope(): SourceResolver {
    let capabilitiesPromise: Promise<CapabilityWMTS[]> | undefined;
    const getCapabilities = async (): Promise<CapabilityWMTS[]> => {
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
    getCapabilities: () => Promise<CapabilityWMTS[]>
  ): Promise<IBasemapLayerSourceOutput> {
    const reference = { type: SourceType.CATALOG_RESOURCE, domain: source.domain, uniqueness: source.uniqueness } as const;
    const unresolved: IBasemapLayerSourceOutput = { ...reference, status: Status.UNRESOLVED, layer: null, capabilities: null };

    const uniqueness = toResolvableUniqueness(source.uniqueness);
    if (uniqueness === undefined) {
      this.logger.warn({ msg: 'catalog reference is incomplete or has an unknown productType - returned as unresolved', ...source.uniqueness });
      return unresolved;
    }

    const layer = await this.rasterCatalogClient.resolveLayer(source.domain, uniqueness).catch((error: unknown) => {
      this.logger.warn({ msg: 'Raster Catalog unavailable - catalog layer returned as unresolved', err: error, ...source.uniqueness });
      return null;
    });
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
