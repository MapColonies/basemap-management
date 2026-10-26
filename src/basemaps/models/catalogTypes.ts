export enum Domain {
  RASTER = 'RASTER',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- value dictated by the shared Domain enum
  '3D' = '3D',
  DEM = 'DEM',
  VECTOR = 'VECTOR',
}

export enum ProductType {
  ORTHOPHOTO = 'Orthophoto',
  ORTHOPHOTO_HISTORY = 'OrthophotoHistory',
  ORTHOPHOTO_BEST = 'OrthophotoBest',
  RASTER_MAP = 'RasterMap',
  RASTER_MAP_BEST = 'RasterMapBest',
  RASTER_AID = 'RasterAid',
  RASTER_AID_BEST = 'RasterAidBest',
  RASTER_VECTOR = 'RasterVector',
  RASTER_VECTOR_BEST = 'RasterVectorBest',
}

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

export interface CapabilityModelType {
  id: string;
  style?: { value: string; isDefault?: string | null }[];
  format?: string[];
  tileMatrixSet?: { tileMatrixSetID: string; tileMatrixLabels: string[] }[];
  url?: { format: string; resourceType: string; template: string }[];
}
