/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import { OGC_ImageryProtocolType, PROPRIETARY_ImageryProtocolType } from '@map-colonies/types';

export const ImageryProtocolType = {
  WMS: OGC_ImageryProtocolType.WMS,
  WMTS: OGC_ImageryProtocolType.WMTS,
  XYZ: OGC_ImageryProtocolType.XYZ,
  OSM: PROPRIETARY_ImageryProtocolType.OSM,
  MAPBOX_STYLE: PROPRIETARY_ImageryProtocolType.MAPBOX_STYLE,
  BING_MAPS: PROPRIETARY_ImageryProtocolType.BING_MAPS,
} as const;
export type ImageryProtocolType = (typeof ImageryProtocolType)[keyof typeof ImageryProtocolType];

export const LinkModelSchema = z.object({
  name: z.string().nullish(),
  description: z.string().nullish(),
  protocol: z.string().optional(),
  url: z.string().optional(),
});
export type LinkModelType = z.infer<typeof LinkModelSchema>;

export const LayerRasterRecordModelSchema = z
  .object({
    id: z.string(),
    type: z.string().nullish(),
    productName: z.string().optional(),
    productId: z.string().nullish(),
    productVersion: z.string().nullish(),
    productType: z.string().optional(),
    footprint: z.unknown().optional(),
    links: z.array(LinkModelSchema).nullish(),
  })
  .passthrough();
export type LayerRasterRecordModelType = z.infer<typeof LayerRasterRecordModelSchema>;
