import type { ProductType } from '@map-colonies/types';

export const THUMBNAIL_DIMENSION_PIXELS = 128;

export const PROTOCOLS = ['XYZ', 'WMTS', 'WMS', 'OSM'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export interface IBasemapThumbnail {
  url: string;
  width: typeof THUMBNAIL_DIMENSION_PIXELS;
  height: typeof THUMBNAIL_DIMENSION_PIXELS;
}

export interface IExternalLayerDetails {
  protocol: Protocol;
  name: string;
  url: string;
  [key: string]: unknown;
}

export interface IExternalLayerSource {
  type: 'EXTERNAL';
  details: IExternalLayerDetails;
}

export interface IRasterResourceLayerSource {
  type: 'RASTER_RESOURCE';
  productId: string;
  productType: ProductType;
}

export interface IRasterResolvedResourceLayerSource {
  type: 'RASTER_RESOLVED_RESOURCE';
  layer: unknown;
}

export type IBasemapLayerSourceInput = IRasterResourceLayerSource | IExternalLayerSource;
export type IBasemapLayerSourceOutput = IRasterResolvedResourceLayerSource | IExternalLayerSource;

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

export interface IImportReviewLayer {
  status: 'RESOLVED' | 'UNRESOLVED';
  opacity: number;
  shouldBeUsedInModelDraping?: boolean;
  source: IBasemapLayerSourceInput;
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
