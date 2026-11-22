/* eslint-disable */
// This file was auto-generated. Do not edit manually.
// To update, run the error generation script again.

import type { TypedRequestHandlers as ImportedTypedRequestHandlers } from '@map-colonies/openapi-express-types';
export type paths = {
  '/basemaps': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List all Basemaps */
    get: operations['listBasemaps'];
    put?: never;
    /** Create a new Basemap. The thumbnail must be a ready URL - uploading the image itself is handled by catalog-web-app-bff (via data-service), not by this service. */
    post: operations['createBasemap'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/basemaps/import/validate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Parse and validate a Basemap export package (ZIP) without persisting anything. Returns a review describing the Basemap, its default-role consequences, and the resolution of every catalog layer against this environment's catalog and MapProxy. Resolution failures are reported, never silently dropped. */
    post: operations['validateBasemapImport'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/basemaps/{basemapId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get a single Basemap */
    get: operations['getBasemap'];
    /** Fully replace a Basemap */
    put: operations['updateBasemap'];
    post?: never;
    /** Delete a Basemap */
    delete: operations['deleteBasemap'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/basemaps/{basemapId}/export': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Export a Basemap as a self-contained, portable ZIP package (configuration + thumbnail binary; no Raster tiles/data). */
    get: operations['exportBasemap'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    /** @description MapProxy WMTS capability of a catalog layer. */
    capability: {
      /** @description Layer identifier */
      id: string;
      /** @description Styles available for the layer */
      style: {
        /** @description Style identifier value */
        value: string;
        /** @description Whether this style is the default style */
        isDefault: string | null;
      }[];
      /** @description MIME types supported by the layer */
      format: string[];
      /** @description TileMatrixSets available for the layer */
      tileMatrixSet: {
        /** @description Identifier of the TileMatrixSet */
        tileMatrixSetID: string;
        /** @description TileMatrix identifier per level */
        tileMatrixLabels: string[];
      }[];
      /** @description Resource URLs available for the layer */
      url: {
        /** @description MIME type of the resource */
        format: string;
        /** @description Type of the resource, e.g. tile */
        resourceType: string;
        /** @description URL template for the resource */
        template: string;
      }[];
    };
    /** @description Identifies a raster catalog product. This is also the persisted/portable identity - there is no environment-specific id. Both fields are optional: a missing, empty or unknown value is accepted and the layer is returned with status UNRESOLVED. */
    rasterUniqueness: {
      /** @description Raster catalog product id */
      productId?: string | null;
      /** @description Raster product type (wire values as in @map-colonies/types, e.g. Orthophoto) */
      productType?: string | null;
    };
    /** @description Configuration for an externally-served layer. `protocol`/`name`/`url` are the only fields this service interprets; additional provider-specific keys are accepted and stored as-is. `protocol` must be one of the shared imagery protocols (WMS, WMTS, XYZ, OSM, MAPBOX_STYLE, BING_MAPS); that list is enforced by the service at request-validation time. */
    externalLayerDetails: {
      /** @description Serving protocol of an external layer */
      protocol: string;
      name: string;
      url: string;
    };
    /** @description A persisted thumbnail reference. The binary image itself lives in data-service (uploaded via catalog-web-app-bff); only its URL is part of the Basemap configuration. */
    basemapThumbnail: {
      url: string;
      /** @enum {number} */
      width: 128;
      /** @enum {number} */
      height: 128;
    };
    /** @description A catalog resource reference, as accepted by POST/PUT, persisted and exported. */
    catalogResourceLayerSource: {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      type: 'CATALOG_RESOURCE';
      /** @enum {string} */
      domain: 'RASTER';
      uniqueness: components['schemas']['rasterUniqueness'];
    };
    /** @description An externally-served layer (not a catalog resource), as accepted by POST/PUT, persisted and exported. */
    externalLayerSource: {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      type: 'EXTERNAL';
      details: components['schemas']['externalLayerDetails'];
    };
    /** @description A Basemap layer's source, as accepted by POST/PUT. */
    basemapLayerSourceInput: components['schemas']['catalogResourceLayerSource'] | components['schemas']['externalLayerSource'];
    basemapLayerInput: {
      id: string;
      order: number;
      opacity: number;
      /** @description Only meaningful for layer sources eligible for 3D model draping. Omitted entirely for ineligible sources - never sent as false/disabled. */
      shouldBeUsedInModelDraping?: boolean;
      source: components['schemas']['basemapLayerSourceInput'];
    };
    /** @description Same shape as a persisted Basemap, minus the server-assigned id. Catalog layer sources are references (no status, layer or capabilities). */
    basemapWriteInput: {
      name: string;
      thumbnail: components['schemas']['basemapThumbnail'];
      /** @description At most one Basemap may have isCurrent=true. Default for the Cesium map viewer. */
      isCurrent: boolean;
      /** @description At most one Basemap may have isForPreview=true. Default for OpenLayers preview viewers. Independent of isCurrent. */
      isForPreview: boolean;
      layers: components['schemas']['basemapLayerInput'][];
    };
    /** @description A Basemap layer as returned by reads, write responses and the import review. A catalog source is RESOLVED only when both the catalog record and its map server capability were found (layer and capabilities are then set); otherwise it is UNRESOLVED and layer and capabilities are null. External sources are always RESOLVED. */
    basemapLayerOutput: {
      id: string;
      order: number;
      opacity: number;
      /** @description Only meaningful for layer sources eligible for 3D model draping. Omitted entirely for ineligible sources - never sent as false/disabled. */
      shouldBeUsedInModelDraping?: boolean;
      source:
        | {
            /** @enum {string} */
            type: 'CATALOG_RESOURCE';
            /** @enum {string} */
            domain: 'RASTER';
            /** @description Identifies a raster catalog product by productId + productType. It is also the persisted, portable identity of a catalog layer - there is no environment-specific id. Both fields are optional. */
            uniqueness: {
              /** @description Raster catalog product id */
              productId?: string | null;
              /** @description Raster product type (wire values as in @map-colonies/types, e.g. Orthophoto) */
              productType?: string | null;
            };
            /** @enum {string} */
            status: 'RESOLVED';
            layer: {
              /** @description Raster catalog product id */
              productId?: string | null;
              /** @description Raster product type (wire values as in @map-colonies/types, e.g. Orthophoto) */
              productType?: string | null;
            };
            capabilities: components['schemas']['capability'];
          }
        | {
            /** @enum {string} */
            type: 'CATALOG_RESOURCE';
            /** @enum {string} */
            domain: 'RASTER';
            /** @description Identifies a raster catalog product by productId + productType. It is also the persisted, portable identity of a catalog layer - there is no environment-specific id. Both fields are optional. */
            uniqueness: {
              /** @description Raster catalog product id */
              productId?: string | null;
              /** @description Raster product type (wire values as in @map-colonies/types, e.g. Orthophoto) */
              productType?: string | null;
            };
            /** @enum {string} */
            status: 'UNRESOLVED';
            /** @enum {object|null} */
            layer: never | null;
            /** @enum {object|null} */
            capabilities: never | null;
          }
        | {
            /** @enum {string} */
            type: 'EXTERNAL';
            /** @description Configuration for an externally-served layer. Provider-specific keys besides protocol, name and url are kept as-is. */
            details: {
              /** @description Serving protocol of an external layer */
              protocol: string;
              name: string;
              url: string;
            };
            /** @enum {string} */
            status: 'RESOLVED';
          };
    };
    basemap: {
      name: string;
      thumbnail: components['schemas']['basemapThumbnail'];
      /** @description At most one Basemap may have isCurrent=true. Default for the Cesium map viewer. */
      isCurrent: boolean;
      /** @description At most one Basemap may have isForPreview=true. Default for OpenLayers preview viewers. Independent of isCurrent. */
      isForPreview: boolean;
      layers: components['schemas']['basemapLayerOutput'][];
      id: string;
    };
    importReviewRoleConflict: {
      basemapId: string;
      basemapName: string;
    };
    /** @description A draft/review model of an imported package, resolved against this environment exactly like a GET. It is never itself persisted and must never be accepted by the Basemap write endpoints. */
    importReview: {
      name: string;
      isCurrent: boolean;
      isForPreview: boolean;
      currentRoleConflict?: components['schemas']['importReviewRoleConflict'] & unknown;
      previewRoleConflict?: components['schemas']['importReviewRoleConflict'] & unknown;
      thumbnail:
        | {
            /** @enum {boolean} */
            included: true;
            width: number;
            height: number;
            /** @enum {string} */
            mimeType: 'image/png' | 'image/webp';
            /** @description The thumbnail binary, base64-encoded, for direct use as in-memory editor state. */
            dataBase64: string;
          }
        | {
            /** @enum {boolean} */
            included: false;
          };
      layers: components['schemas']['basemapLayerOutput'][];
    };
    error: {
      message: string;
    };
    basemapId: string;
  };
  responses: {
    /** @description Bad Request */
    badRequest: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['error'];
      };
    };
    /** @description Not Found */
    notFound: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['error'];
      };
    };
  };
  parameters: {
    basemapId: components['schemas']['basemapId'];
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
  listBasemaps: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['basemap'][];
        };
      };
      400: components['responses']['badRequest'];
    };
  };
  createBasemap: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['basemapWriteInput'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['basemap'];
        };
      };
      400: components['responses']['badRequest'];
    };
  };
  validateBasemapImport: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'multipart/form-data': {
          /**
           * Format: binary
           * @description The Basemap export ZIP package (basemap.json + thumbnail binary).
           */
          package: string;
        };
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['importReview'];
        };
      };
      400: components['responses']['badRequest'];
    };
  };
  getBasemap: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        basemapId: components['parameters']['basemapId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['basemap'];
        };
      };
      404: components['responses']['notFound'];
    };
  };
  updateBasemap: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        basemapId: components['parameters']['basemapId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['basemapWriteInput'];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['basemap'];
        };
      };
      400: components['responses']['badRequest'];
      404: components['responses']['notFound'];
    };
  };
  deleteBasemap: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        basemapId: components['parameters']['basemapId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description No Content */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['notFound'];
    };
  };
  exportBasemap: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        basemapId: components['parameters']['basemapId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/zip': string;
        };
      };
      404: components['responses']['notFound'];
    };
  };
}
export type TypedRequestHandlers = ImportedTypedRequestHandlers<paths, operations>;
