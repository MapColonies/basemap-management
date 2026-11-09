/* eslint-disable @typescript-eslint/naming-convention, import-x/exports-last */
import type { z } from 'zod';
import {
  type ProductType,
  type BasemapLayerSourceInputSchema,
  type BasemapLayerInputSchema,
  type BasemapWriteInputSchema,
  type PersistedBasemapSchema,
  type CatalogResourceLayerSourceSchema,
  type ExternalLayerDetailsSchema,
  type ExternalLayerSourceInputSchema,
  type ExternalLayerSourceOutputSchema,
  type UnresolvedCatalogResourceLayerSourceSchema,
  createResolvedCatalogResourceLayerSourceSchema,
  createBasemapLayerSourceOutputSchema,
  createBasemapLayerOutputSchema,
  createBasemapSchema,
} from '@map-colonies/types';
import { CapabilityWMTSSchema, type CapabilityWMTS } from '@map-colonies/wmts-client';
import { ImageryProtocolType, LayerRasterRecordModelSchema, type LayerRasterRecordModelType } from './catalogTypes';

export { ResourceResolutionStatus as Status } from '@map-colonies/types';

export const THUMBNAIL_DIMENSION_PIXELS = 128;

export const PROTOCOLS: readonly string[] = Object.values(ImageryProtocolType);

export interface IBasemapThumbnail {
  url: string;
  width: typeof THUMBNAIL_DIMENSION_PIXELS;
  height: typeof THUMBNAIL_DIMENSION_PIXELS;
}

export interface IResolvableRasterUniqueness {
  productId: string;
  productType: ProductType;
}

export type IExternalLayerDetails = z.infer<typeof ExternalLayerDetailsSchema>;
export type IExternalLayerSourceInput = z.infer<typeof ExternalLayerSourceInputSchema>;
export type IExternalLayerSourceOutput = z.infer<typeof ExternalLayerSourceOutputSchema>;

export type ICatalogResourceLayerSource = z.infer<typeof CatalogResourceLayerSourceSchema>;
export type IRasterUniqueness = ICatalogResourceLayerSource['uniqueness'];

const ResolvedCatalogResourceLayerSourceSchema = createResolvedCatalogResourceLayerSourceSchema(LayerRasterRecordModelSchema, CapabilityWMTSSchema);
export type IResolvedCatalogResourceLayerSource = z.infer<typeof ResolvedCatalogResourceLayerSourceSchema>;
export type IUnresolvedCatalogResourceLayerSource = z.infer<typeof UnresolvedCatalogResourceLayerSourceSchema>;

export type IBasemapLayerSourceInput = z.infer<typeof BasemapLayerSourceInputSchema>;

const BasemapLayerSourceOutputSchema = createBasemapLayerSourceOutputSchema(LayerRasterRecordModelSchema, CapabilityWMTSSchema);
export type IBasemapLayerSourceOutput = z.infer<typeof BasemapLayerSourceOutputSchema>;

export type IBasemapLayerInput = z.infer<typeof BasemapLayerInputSchema>;

const BasemapLayerOutputSchema = createBasemapLayerOutputSchema(LayerRasterRecordModelSchema, CapabilityWMTSSchema);
export type IBasemapLayerOutput = z.infer<typeof BasemapLayerOutputSchema>;

const BasemapSchema = createBasemapSchema(LayerRasterRecordModelSchema, CapabilityWMTSSchema);
export type IBasemap = z.infer<typeof BasemapSchema>;

export type IBasemapWriteInput = z.infer<typeof BasemapWriteInputSchema>;

export type IPersistedBasemap = z.infer<typeof PersistedBasemapSchema>;

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

export type { CapabilityWMTS, LayerRasterRecordModelType };
