/* eslint-disable @typescript-eslint/naming-convention */
import type { z } from 'zod';
import { OGC_ImageryProtocolType, PROPRIETARY_ImageryProtocolType, RasterUniquenessSchema } from '@map-colonies/types';

export const ImageryProtocolType = {
  WMS: OGC_ImageryProtocolType.WMS,
  WMTS: OGC_ImageryProtocolType.WMTS,
  XYZ: OGC_ImageryProtocolType.XYZ,
  OSM: PROPRIETARY_ImageryProtocolType.OSM,
  MAPBOX_STYLE: PROPRIETARY_ImageryProtocolType.MAPBOX_STYLE,
  BING_MAPS: PROPRIETARY_ImageryProtocolType.BING_MAPS,
} as const;
export type ImageryProtocolType = (typeof ImageryProtocolType)[keyof typeof ImageryProtocolType];

export const LayerRasterRecordModelSchema = RasterUniquenessSchema.passthrough();
export type LayerRasterRecordModelType = z.infer<typeof LayerRasterRecordModelSchema>;
