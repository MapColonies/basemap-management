import type { ProductType } from '@map-colonies/types';
import {
  type Basemap as SharedBasemap,
  type BasemapLayerInput,
  type BasemapLayerOutput as SharedBasemapLayerOutput,
  type BasemapLayerSourceInput,
  type BasemapLayerSourceOutput as SharedBasemapLayerSourceOutput,
  type BasemapWriteInput,
  type CatalogResourceLayerSource,
  type ExternalLayerSource,
  type PersistedBasemap,
  type RasterUniqueness,
} from '@map-colonies/app-shared';
import type { CapabilityWMTS } from '@map-colonies/wmts-client';
import { ImageryProtocolType, type LayerRasterRecord } from './catalogTypes';

export { ResourceResolutionStatus as Status } from '@map-colonies/app-shared';
export type {
  BasemapLayerInput,
  BasemapLayerSourceInput,
  BasemapWriteInput,
  CatalogResourceLayerSource,
  ExternalLayerSource,
  PersistedBasemap,
  RasterUniqueness,
};

export const THUMBNAIL_DIMENSION_PIXELS = 128;

export const PROTOCOLS: readonly string[] = Object.values(ImageryProtocolType);

export interface BasemapThumbnail {
  url: string;
  width: typeof THUMBNAIL_DIMENSION_PIXELS;
  height: typeof THUMBNAIL_DIMENSION_PIXELS;
}

export interface ResolvableRasterUniqueness {
  productId: string;
  productType: ProductType;
}

export type BasemapLayerSourceOutput = SharedBasemapLayerSourceOutput<LayerRasterRecord, CapabilityWMTS>;
export type BasemapLayerOutput = SharedBasemapLayerOutput<LayerRasterRecord, CapabilityWMTS>;
export type Basemap = SharedBasemap<LayerRasterRecord, CapabilityWMTS>;

export interface PortableBasemapThumbnail {
  file: string;
  width: number;
  height: number;
}

export interface PortableBasemap {
  name: string;
  isCurrent: boolean;
  isForPreview: boolean;
  thumbnail: PortableBasemapThumbnail;
  layers: BasemapLayerInput[];
}

export interface ImportPackageThumbnail {
  mimeType: 'image/png' | 'image/webp';
  buffer: Buffer;
  width: number;
  height: number;
}

export interface ImportReviewRoleConflict {
  basemapId: string;
  basemapName: string;
}

export type ImportReviewLayer = BasemapLayerOutput;

export type ImportReviewThumbnail =
  { included: true; width: number; height: number; mimeType: 'image/png' | 'image/webp'; dataBase64: string } | { included: false };

export interface ImportReview {
  name: string;
  isCurrent: boolean;
  isForPreview: boolean;
  currentRoleConflict?: ImportReviewRoleConflict;
  previewRoleConflict?: ImportReviewRoleConflict;
  thumbnail: ImportReviewThumbnail;
  layers: ImportReviewLayer[];
}

export type { CapabilityWMTS, LayerRasterRecord };
