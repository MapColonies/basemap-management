import { ProtocolType } from './catalogTypes';
import type { CapabilityModelType, Domain, LayerRasterRecordModelType, ProductType } from './catalogTypes';

export const THUMBNAIL_DIMENSION_PIXELS = 128;

export const PROTOCOLS: readonly ProtocolType[] = Object.values(ProtocolType);

export enum SourceTypeInput {
  CATALOG_RESOURCE = 'CATALOG_RESOURCE',
  EXTERNAL = 'EXTERNAL',
}

export enum SourceTypeOutput {
  RESOLVED_CATALOG_RESOURCE = 'RESOLVED_CATALOG_RESOURCE',
  UNRESOLVED_CATALOG_RESOURCE = 'UNRESOLVED_CATALOG_RESOURCE',
  EXTERNAL = 'EXTERNAL',
}

export interface IBasemapThumbnail {
  url: string;
  width: typeof THUMBNAIL_DIMENSION_PIXELS;
  height: typeof THUMBNAIL_DIMENSION_PIXELS;
}

export interface IRasterUniqueness {
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
  type: SourceTypeInput.EXTERNAL;
  details: IExternalLayerDetails;
}

export interface IExternalLayerSourceOutput {
  type: SourceTypeOutput.EXTERNAL;
  details: IExternalLayerDetails;
}

export interface ICatalogResourceLayerSource {
  type: SourceTypeInput.CATALOG_RESOURCE;
  domain: Domain.RASTER;
  uniqueness: IRasterUniqueness;
}

export interface IResolvedCatalogResourceLayerSource {
  type: SourceTypeOutput.RESOLVED_CATALOG_RESOURCE;
  domain: Domain.RASTER;
  layer: LayerRasterRecordModelType;
  capabilities: CapabilityModelType;
}

export interface IUnresolvedCatalogResourceLayerSource {
  type: SourceTypeOutput.UNRESOLVED_CATALOG_RESOURCE;
  domain: Domain.RASTER;
  uniqueness: IRasterUniqueness;
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

export interface IImportReviewLayer extends IBasemapLayerOutput {
  status: 'RESOLVED' | 'UNRESOLVED';
}

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
