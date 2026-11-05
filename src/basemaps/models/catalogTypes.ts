import type { ProductType } from '@map-colonies/types';

// eslint-disable-next-line @typescript-eslint/naming-convention -- const-object + type idiom mirrored from catalog-app
export const ProtocolType = {
  /* eslint-disable @typescript-eslint/naming-convention -- protocol identifiers */
  XYZ: 'XYZ',
  WMTS: 'WMTS',
  WMS: 'WMS',
  OSM: 'OSM',
  /* eslint-enable @typescript-eslint/naming-convention */
} as const;
export type ProtocolType = (typeof ProtocolType)[keyof typeof ProtocolType];

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
