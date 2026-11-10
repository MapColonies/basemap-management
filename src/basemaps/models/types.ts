import type {
  ProductType,
  Basemap,
  BasemapLayerInput,
  BasemapLayerOutput,
  BasemapLayerSourceInput,
  BasemapLayerSourceOutput,
  BasemapWriteInput,
  CatalogResourceLayerSource,
  PersistedBasemap,
  RasterUniqueness,
} from '@map-colonies/types';
import type { CapabilityWMTS } from '@map-colonies/wmts-client';
import { ImageryProtocolType, type LayerRasterRecordModelType } from './catalogTypes';

export { ResourceResolutionStatus as Status } from '@map-colonies/types';

export const THUMBNAIL_DIMENSION_PIXELS = 128;

export const PROTOCOLS: readonly string[] = Object.values(ImageryProtocolType);

export interface IResolvableRasterUniqueness {
  productId: string;
  productType: ProductType;
}

export type IRasterUniqueness = RasterUniqueness;

export type ICatalogResourceLayerSource = CatalogResourceLayerSource;
export type IBasemapLayerSourceInput = BasemapLayerSourceInput;
export type IBasemapLayerSourceOutput = BasemapLayerSourceOutput<LayerRasterRecordModelType, CapabilityWMTS>;

export type IBasemapLayerInput = BasemapLayerInput;
export type IBasemapLayerOutput = BasemapLayerOutput<LayerRasterRecordModelType, CapabilityWMTS>;

export type IBasemapWriteInput = BasemapWriteInput;
export type IPersistedBasemap = PersistedBasemap;
export type IBasemap = Basemap<LayerRasterRecordModelType, CapabilityWMTS>;

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
