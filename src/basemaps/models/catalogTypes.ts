import { OGC_ImageryProtocolType, PROPRIETARY_ImageryProtocolType, type ProductType } from '@map-colonies/types';

export const ImageryProtocolType = {
  /* eslint-disable @typescript-eslint/naming-convention */
  WMS: OGC_ImageryProtocolType.WMS,
  WMTS: OGC_ImageryProtocolType.WMTS,
  XYZ: OGC_ImageryProtocolType.XYZ,
  OSM: PROPRIETARY_ImageryProtocolType.OSM,
  MAPBOX_STYLE: PROPRIETARY_ImageryProtocolType.MAPBOX_STYLE,
  BING_MAPS: PROPRIETARY_ImageryProtocolType.BING_MAPS,
  /* eslint-enable @typescript-eslint/naming-convention */
} as const;
export type ImageryProtocolType = (typeof ImageryProtocolType)[keyof typeof ImageryProtocolType];

export interface LinkModelType {
  name?: string | null;
  description?: string | null;
  protocol?: string;
  url?: string;
}

export interface LayerRasterRecordModelType {
  id: string;
  type?: string | null;
  productName?: string;
  productId?: string | null;
  productVersion?: string | null;
  productType?: ProductType;
  footprint?: unknown;
  links?: LinkModelType[] | null;
  [key: string]: unknown;
}
