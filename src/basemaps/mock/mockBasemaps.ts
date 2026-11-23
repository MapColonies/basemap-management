import { Domain, ProductType } from '@map-colonies/types';
import { SourceType, type CatalogResourceLayerSource, type PersistedBasemap } from '@map-colonies/app-shared';

const MOCK_CATALOG_PRODUCT = { productId: 'MADRID_HEXAGON', productType: ProductType.ORTHOPHOTO } as const;

const MOCK_THUMBNAIL = {
  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAAw0lEQVR42u3RMQEAAAzCMPyrQSIytiOV0KQ6LRYAACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAB8aFsnB72+Q3bTAAAAAElFTkSuQmCC',
  width: 128,
  height: 128,
} as const;

const CATALOG_SOURCE: CatalogResourceLayerSource = {
  type: SourceType.CATALOG_RESOURCE,
  domain: Domain.RASTER,
  uniqueness: { productId: MOCK_CATALOG_PRODUCT.productId, productType: MOCK_CATALOG_PRODUCT.productType },
};

const UNKNOWN_CATALOG_SOURCE: CatalogResourceLayerSource = {
  type: SourceType.CATALOG_RESOURCE,
  domain: Domain.RASTER,
  uniqueness: { productId: 'Unknown_Mock_Product', productType: MOCK_CATALOG_PRODUCT.productType },
};

const MOCK_PERSISTED_BASEMAPS: PersistedBasemap[] = [
  {
    id: 'basemap-01',
    name: 'OpenStreetMap',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: true,
    isForPreview: false,
    layers: [
      {
        id: 'layer-01-01',
        order: 0,
        opacity: 1,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'XYZ',
            name: 'OpenStreetMap Standard',
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '© OpenStreetMap contributors',
          },
        },
      },
      { id: 'layer-01-02', order: 1, opacity: 1, shouldBeUsedInModelDraping: true, source: CATALOG_SOURCE },
      { id: 'layer-01-03', order: 2, opacity: 1, shouldBeUsedInModelDraping: true, source: UNKNOWN_CATALOG_SOURCE },
    ],
  },
  {
    id: 'basemap-02',
    name: 'Satellite',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [{ id: 'layer-02-01', order: 0, opacity: 1, shouldBeUsedInModelDraping: true, source: CATALOG_SOURCE }],
  },
  {
    id: 'basemap-03',
    name: 'Hybrid',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      { id: 'layer-03-01', order: 0, opacity: 1, source: CATALOG_SOURCE },
      {
        id: 'layer-03-02',
        order: 1,
        opacity: 0.9,
        source: {
          type: SourceType.EXTERNAL,
          details: { protocol: 'XYZ', name: 'OpenStreetMap Labels', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
        },
      },
    ],
  },
  {
    id: 'basemap-04',
    name: 'Terrain',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      {
        id: 'layer-04-01',
        order: 0,
        opacity: 1,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'XYZ',
            name: 'OpenTopoMap',
            url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: '© OpenTopoMap contributors',
          },
        },
      },
    ],
  },
  {
    id: 'basemap-05',
    name: 'Light Gray',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      {
        id: 'layer-05-01',
        order: 0,
        opacity: 1,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'XYZ',
            name: 'CartoDB Positron',
            url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            attribution: '© OpenStreetMap contributors © CARTO',
          },
        },
      },
    ],
  },
  {
    id: 'basemap-06',
    name: 'Dark Gray',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      {
        id: 'layer-06-01',
        order: 0,
        opacity: 1,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'XYZ',
            name: 'CartoDB Dark Matter',
            url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            attribution: '© OpenStreetMap contributors © CARTO',
          },
        },
      },
    ],
  },
  {
    id: 'basemap-07',
    name: 'Streets',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      {
        id: 'layer-07-01',
        order: 0,
        opacity: 1,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'XYZ',
            name: 'Esri World Street Map',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Esri and its data providers',
          },
        },
      },
    ],
  },
  {
    id: 'basemap-08',
    name: 'World Imagery',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      {
        id: 'layer-08-01',
        order: 0,
        opacity: 1,
        shouldBeUsedInModelDraping: true,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'XYZ',
            name: 'Esri World Imagery',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Esri and its data providers',
          },
        },
      },
    ],
  },
  {
    id: 'basemap-09',
    name: 'Topographic Overlay',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: true,
    layers: [
      { id: 'layer-09-01', order: 0, opacity: 0.8, source: CATALOG_SOURCE },
      {
        id: 'layer-09-02',
        order: 1,
        opacity: 0.65,
        source: {
          type: SourceType.EXTERNAL,
          details: { protocol: 'XYZ', name: 'OpenTopoMap Overlay', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png' },
        },
      },
    ],
  },
  {
    id: 'basemap-10',
    name: 'Elevation',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [{ id: 'layer-10-01', order: 0, opacity: 0.95, shouldBeUsedInModelDraping: true, source: CATALOG_SOURCE }],
  },
  {
    id: 'basemap-11',
    name: 'Aerial with Labels',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      {
        id: 'layer-11-01',
        order: 0,
        opacity: 1,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'XYZ',
            name: 'Esri World Imagery',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          },
        },
      },
      {
        id: 'layer-11-02',
        order: 1,
        opacity: 1,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'XYZ',
            name: 'Esri Reference Labels',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          },
        },
      },
    ],
  },
  {
    id: 'basemap-12',
    name: 'National Geographic',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      {
        id: 'layer-12-01',
        order: 0,
        opacity: 1,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'XYZ',
            name: 'Esri National Geographic',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
          },
        },
      },
    ],
  },
  {
    id: 'basemap-13',
    name: 'WMTS Sample',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      {
        id: 'layer-13-01',
        order: 0,
        opacity: 0.85,
        source: {
          type: SourceType.EXTERNAL,
          details: {
            protocol: 'WMTS',
            name: 'Sample WMTS Layer',
            url: 'https://example.com/geoserver/gwc/service/wmts',
            layer: 'workspace:sample_layer',
            matrixSet: 'EPSG:3857',
            format: 'image/png',
            style: 'default',
          },
        },
      },
    ],
  },
  {
    id: 'basemap-14',
    name: 'Custom Raster Composite',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [
      { id: 'layer-14-01', order: 0, opacity: 0.75, shouldBeUsedInModelDraping: true, source: CATALOG_SOURCE },
      { id: 'layer-14-02', order: 1, opacity: 0.5, source: CATALOG_SOURCE },
      {
        id: 'layer-14-03',
        order: 2,
        opacity: 0.9,
        source: {
          type: SourceType.EXTERNAL,
          details: { protocol: 'XYZ', name: 'Street Overlay', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
        },
      },
      { id: 'layer-14-04', order: 3, opacity: 1, source: UNKNOWN_CATALOG_SOURCE },
    ],
  },
  {
    id: 'basemap-15',
    name: 'Minimal Preview',
    thumbnail: MOCK_THUMBNAIL,
    isCurrent: false,
    isForPreview: false,
    layers: [{ id: 'layer-15-01', order: 0, opacity: 0.4, source: CATALOG_SOURCE }],
  },
];

export { MOCK_CATALOG_PRODUCT, MOCK_PERSISTED_BASEMAPS };
