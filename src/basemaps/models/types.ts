// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- SourceType needs a value import: used only via `typeof SourceType.X` below, which the rule doesn't detect as a value usage.
import { SourceType, type Capability, type Domain, type ProductType } from '@map-colonies/types';
import { ProtocolType } from './catalogTypes';
import type { LayerRasterRecordModelType } from './catalogTypes';

export const THUMBNAIL_DIMENSION_PIXELS = 128;

export const PROTOCOLS: readonly ProtocolType[] = Object.values(ProtocolType);

export enum Status {
  RESOLVED = 'RESOLVED',
  UNRESOLVED = 'UNRESOLVED',
}

export interface IBasemapThumbnail {
  url: string;
  width: typeof THUMBNAIL_DIMENSION_PIXELS;
  height: typeof THUMBNAIL_DIMENSION_PIXELS;
}

export type IRasterUniqueness = Pick<LayerRasterRecordModelType, 'productId' | 'productType'>;

export interface IResolvableRasterUniqueness {
  productId: string;
  productType: ProductType;
}

export interface IExternalLayerDetails {
  protocol: ProtocolType;
  name: string;
  url: string;
  [key: string]: unknown;
}

export interface IExternalLayerSourceInput {
  type: typeof SourceType.EXTERNAL;
  details: IExternalLayerDetails;
}

export interface IExternalLayerSourceOutput {
  type: typeof SourceType.EXTERNAL;
  status: Status.RESOLVED;
  details: IExternalLayerDetails;
}

export interface ICatalogResourceLayerSource {
  type: typeof SourceType.CATALOG_RESOURCE;
  domain: Domain.RASTER;
  uniqueness: IRasterUniqueness;
}

export interface ICatalogResourceLayerSourceOutputBase {
  type: typeof SourceType.CATALOG_RESOURCE;
  domain: Domain.RASTER;
  uniqueness: IRasterUniqueness;
}

export interface IResolvedCatalogResourceLayerSource extends ICatalogResourceLayerSourceOutputBase {
  status: Status.RESOLVED;
  layer: LayerRasterRecordModelType;
  capabilities: Capability;
}

export interface IUnresolvedCatalogResourceLayerSource extends ICatalogResourceLayerSourceOutputBase {
  status: Status.UNRESOLVED;
  layer: null;
  capabilities: null;
}

export type IBasemapLayerSourceInput = ICatalogResourceLayerSource | IExternalLayerSourceInput;
export type IBasemapLayerSourceOutput = IResolvedCatalogResourceLayerSource | IUnresolvedCatalogResourceLayerSource | IExternalLayerSourceOutput;

export interface IBasemapLayerBase {
  id: string;
  order: number;
  opacity: number;
  shouldBeUsedInModelDraping?: boolean;
}

export interface IBasemapLayerInput extends IBasemapLayerBase {
  source: IBasemapLayerSourceInput;
}

export interface IBasemapLayerOutput extends IBasemapLayerBase {
  source: IBasemapLayerSourceOutput;
}

export interface IBasemap {
  id: string;
  name: string;
  thumbnail: IBasemapThumbnail;
  isCurrent: boolean;
  isForPreview: boolean;
  layers: IBasemapLayerOutput[];
}

export interface IBasemapWriteInput {
  name: string;
  thumbnail: IBasemapThumbnail;
  isCurrent: boolean;
  isForPreview: boolean;
  layers: IBasemapLayerInput[];
}

export interface IPersistedBasemap {
  id: string;
  name: string;
  thumbnail: IBasemapThumbnail;
  isCurrent: boolean;
  isForPreview: boolean;
  layers: IBasemapLayerInput[];
}

export interface IPortableBasemapThumbnail {
  file: string;
  width: number;
  height: number;
}

export interface IPortableBasemap {
  name: string;
  isCurrent: boolean;
  isForPreview: boolean;
  thumbnail: IPortableBasemapThumbnail;
  layers: IBasemapLayerInput[];
}

export interface IImportPackageThumbnail {
  mimeType: 'image/png' | 'image/webp';
  buffer: Buffer;
  width: number;
  height: number;
}

export interface IImportReviewRoleConflict {
  basemapId: string;
  basemapName: string;
}

export type IImportReviewLayer = IBasemapLayerOutput;

export type IImportReviewThumbnail =
  { included: true; width: number; height: number; mimeType: 'image/png' | 'image/webp'; dataBase64: string } | { included: false };

export interface IImportReview {
  name: string;
  isCurrent: boolean;
  isForPreview: boolean;
  currentRoleConflict?: IImportReviewRoleConflict;
  previewRoleConflict?: IImportReviewRoleConflict;
  thumbnail: IImportReviewThumbnail;
  layers: IImportReviewLayer[];
}
