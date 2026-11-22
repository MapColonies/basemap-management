/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention */
/**
 * Builds openapi3.yaml from the Zod schemas that actually validate requests and persisted data
 * (`@map-colonies/app-shared`), using only the public API of `@asteasolutions/zod-to-openapi`.
 *
 * This is a CommonJS TypeScript module run by plain Node (native type stripping - no tsx, no build).
 * It must stay CommonJS: `@map-colonies/app-shared` is CommonJS and therefore uses zod's CommonJS
 * build. An ES module here would import zod's ES build - a second, unpatched copy of every Zod class.
 *
 * How `$ref`s are produced without touching library internals:
 * `registry.register(name, schema)` returns a *copy* of `schema` that carries the component name. The
 * app-shared compositions (e.g. `BasemapWriteInputSchema.layers[].source`) were built from the
 * un-named originals, so they would be inlined. At each composition joint we therefore re-compose
 * with `.extend()` / `z.discriminatedUnion()`, replacing only the nested field with its registered copy.
 * Every validation rule still comes from app-shared; `assertSchemasEquivalent` proves at generation
 * time that each composed schema is identical to the app-shared schema it stands for.
 */
import type * as ZodToOpenApi from '@asteasolutions/zod-to-openapi';
import type * as AppShared from '@map-colonies/app-shared';
import type * as WmtsClient from '@map-colonies/wmts-client';
import type * as JsYaml from 'js-yaml';
import type * as Prettier from 'prettier';
import type * as Zod from 'zod';
import type * as CatalogTypes from '../src/basemaps/models/catalogTypes';
import type * as ImportReviewSchemas from '../src/basemaps/models/importReview.schema';

type OpenAPIRegistryType = ZodToOpenApi.OpenAPIRegistry;
type RouteConfig = ZodToOpenApi.RouteConfig;
type ZodTypeAny = Zod.ZodTypeAny;

const { z } = require('zod') as typeof Zod;
const { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } = require('@asteasolutions/zod-to-openapi') as typeof ZodToOpenApi;
const shared = require('@map-colonies/app-shared') as typeof AppShared;
const { CapabilityWMTSSchema } = require('@map-colonies/wmts-client') as typeof WmtsClient;
const { LayerRasterRecordSchema } = require('../src/basemaps/models/catalogTypes.ts') as typeof CatalogTypes;
const { ImportReviewBaseSchema, ImportReviewRoleConflictSchema } =
  require('../src/basemaps/models/importReview.schema.ts') as typeof ImportReviewSchemas;

extendZodWithOpenApi(z);

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const OPENAPI_VERSION = '3.0.1';
const GENERATED_FILE_HEADER = [
  '# GENERATED FILE - DO NOT EDIT.',
  '# Generated from the Zod schemas (@map-colonies/app-shared and src/basemaps/models) by openapi/document.cts.',
  '# Run `npm run generate:openapi` to regenerate it, then `npm run generate:openapi-types`.',
].join('\n');

/**
 * The service's own `importReview.schema.ts` is loaded as an ES module (plain Node, typeless package),
 * so it uses zod's ES build. Patch that copy too before registering anything built from it.
 */
async function extendEsmZod(): Promise<void> {
  const esmZod = await import('zod');
  extendZodWithOpenApi(esmZod.z);
}

/** Registers the reusable components and returns the composed schemas used by the operations. */
function registerSchemas(registry: OpenAPIRegistryType): ComposedSchemas {
  const register = <T extends ZodTypeAny>(name: string, schema: T, description?: string): T =>
    registry.register(name, description === undefined ? schema : schema.openapi({ description }));

  // leaves: registered copies of the app-shared schemas, unchanged
  const capability = register('capability', CapabilityWMTSSchema, 'MapProxy WMTS capability of a catalog layer.');
  const uniqueness = register(
    'rasterUniqueness',
    shared.RasterUniquenessSchema,
    'Identifies a raster catalog product. This is also the persisted/portable identity - there is no environment-specific id. Both fields are optional: a missing, empty or unknown value is accepted and the layer is returned with status UNRESOLVED.'
  );
  const details = register(
    'externalLayerDetails',
    shared.ExternalLayerDetailsSchema,
    'Configuration for an externally-served layer. `protocol`/`name`/`url` are the only fields this service interprets; additional provider-specific keys are accepted and stored as-is. `protocol` must be one of the shared imagery protocols (WMS, WMTS, XYZ, OSM, MAPBOX_STYLE, BING_MAPS); that list is enforced by the service at request-validation time.'
  );
  const thumbnail = register(
    'basemapThumbnail',
    shared.BasemapThumbnailSchema,
    'A persisted thumbnail reference. The binary image itself lives in data-service (uploaded via catalog-web-app-bff); only its URL is part of the Basemap configuration.'
  );

  // joints: the app-shared object, with only the nested field replaced by its registered copy
  const catalogSource = register(
    'catalogResourceLayerSource',
    shared.CatalogResourceLayerSourceSchema.extend({ uniqueness }),
    'A catalog resource reference, as accepted by POST/PUT, persisted and exported.'
  );
  const externalSource = register(
    'externalLayerSource',
    shared.ExternalLayerSourceSchema.extend({ details }),
    'An externally-served layer (not a catalog resource), as accepted by POST/PUT, persisted and exported.'
  );
  const sourceInput = register(
    'basemapLayerSourceInput',
    z.discriminatedUnion('type', [catalogSource, externalSource]),
    "A Basemap layer's source, as accepted by POST/PUT."
  );
  // field documentation: `.describe()` returns a copy with the same checks (the guard verifies that)
  const writeShape = shared.BasemapWriteInputSchema.shape;
  const roleFlags = {
    isCurrent: writeShape.isCurrent.describe('At most one Basemap may have isCurrent=true. Default for the Cesium map viewer.'),
    isForPreview: writeShape.isForPreview.describe(
      'At most one Basemap may have isForPreview=true. Default for OpenLayers preview viewers. Independent of isCurrent.'
    ),
  };
  const layerInput = register(
    'basemapLayerInput',
    shared.BasemapLayerInputSchema.extend({
      shouldBeUsedInModelDraping: shared.BasemapLayerInputSchema.shape.shouldBeUsedInModelDraping.describe(
        'Only meaningful for layer sources eligible for 3D model draping. Omitted entirely for ineligible sources - never sent as false/disabled.'
      ),
      source: sourceInput,
    })
  );
  const writeInput = register(
    'basemapWriteInput',
    shared.BasemapWriteInputSchema.extend({ ...roleFlags, thumbnail, layers: z.array(layerInput) }),
    'Same shape as a persisted Basemap, minus the server-assigned id. Catalog layer sources are references (no status, layer or capabilities).'
  );

  // output: the app-shared factory builds the layer (its 3-branch source union stays inline)
  const layerOutputReference = shared.createBasemapLayerOutputSchema(LayerRasterRecordSchema, CapabilityWMTSSchema);
  const layerOutput = register(
    'basemapLayerOutput',
    shared.createBasemapLayerOutputSchema(LayerRasterRecordSchema, capability),
    'A Basemap layer as returned by reads, write responses and the import review. A catalog source is RESOLVED only when both the catalog record and its map server capability were found (layer and capabilities are then set); otherwise it is UNRESOLVED and layer and capabilities are null. External sources are always RESOLVED.'
  );
  const basemapReference = shared.createBasemapSchema(LayerRasterRecordSchema, CapabilityWMTSSchema);
  const basemap = register('basemap', shared.PersistedBasemapSchema.extend({ ...roleFlags, thumbnail, layers: z.array(layerOutput) }));

  // import review (service-owned)
  const roleConflict = register('importReviewRoleConflict', ImportReviewRoleConflictSchema);
  const importReviewShape = ImportReviewBaseSchema.shape;
  const importReviewReference = ImportReviewBaseSchema.extend({ layers: z.array(layerOutputReference) });
  const importReview = register(
    'importReview',
    ImportReviewBaseSchema.extend({
      currentRoleConflict: roleConflict.optional().describe(importReviewShape.currentRoleConflict.description ?? ''),
      previewRoleConflict: roleConflict.optional().describe(importReviewShape.previewRoleConflict.description ?? ''),
      layers: z.array(layerOutput),
    }),
    'A draft/review model of an imported package, resolved against this environment exactly like a GET. It is never itself persisted and must never be accepted by the Basemap write endpoints.'
  );

  return {
    writeInput,
    basemap,
    importReview,
    equivalences: [
      { name: 'catalogResourceLayerSource', composed: catalogSource, reference: shared.CatalogResourceLayerSourceSchema },
      { name: 'externalLayerSource', composed: externalSource, reference: shared.ExternalLayerSourceSchema },
      { name: 'basemapLayerSourceInput', composed: sourceInput, reference: shared.BasemapLayerSourceInputSchema },
      { name: 'basemapLayerInput', composed: layerInput, reference: shared.BasemapLayerInputSchema },
      { name: 'basemapWriteInput', composed: writeInput, reference: shared.BasemapWriteInputSchema },
      { name: 'basemapLayerOutput', composed: layerOutput, reference: layerOutputReference },
      { name: 'basemap', composed: basemap, reference: basemapReference },
      { name: 'importReview', composed: importReview, reference: importReviewReference },
    ],
  };
}

function registerPaths(registry: OpenAPIRegistryType, schemas: ComposedSchemas): void {
  const ERROR_COMPONENT = 'error';
  registry.register(ERROR_COMPONENT, z.object({ message: z.string() }));
  const json = (schema: ZodTypeAny): { content: { 'application/json': { schema: ZodTypeAny } } } => ({
    content: { 'application/json': { schema } },
  });
  // registerComponent() takes plain OpenAPI objects, so the error body is referenced by name
  const errorRef = { $ref: `#/components/schemas/${ERROR_COMPONENT}` };
  registry.registerComponent('responses', 'badRequest', { description: 'Bad Request', content: { 'application/json': { schema: errorRef } } });
  registry.registerComponent('responses', 'notFound', { description: 'Not Found', content: { 'application/json': { schema: errorRef } } });
  const badRequest = { $ref: '#/components/responses/badRequest' };
  const notFound = { $ref: '#/components/responses/notFound' };

  const basemapId = registry.registerParameter('basemapId', z.string().openapi({ param: { name: 'basemapId', in: 'path' } }));
  const params = z.object({ basemapId });
  const tags = ['basemaps'];

  const routes: RouteConfig[] = [
    {
      method: 'get',
      path: '/basemaps',
      operationId: 'listBasemaps',
      tags,
      summary: 'List all Basemaps',
      responses: { 200: { description: 'OK', ...json(z.array(schemas.basemap)) }, 400: badRequest },
    },
    {
      method: 'post',
      path: '/basemaps',
      operationId: 'createBasemap',
      tags,
      summary:
        'Create a new Basemap. The thumbnail must be a ready URL - uploading the image itself is handled by catalog-web-app-bff (via data-service), not by this service.',
      request: { body: { required: true, ...json(schemas.writeInput) } },
      responses: { 201: { description: 'Created', ...json(schemas.basemap) }, 400: badRequest },
    },
    {
      method: 'post',
      path: '/basemaps/import/validate',
      operationId: 'validateBasemapImport',
      tags,
      summary:
        "Parse and validate a Basemap export package (ZIP) without persisting anything. Returns a review describing the Basemap, its default-role consequences, and the resolution of every catalog layer against this environment's catalog and MapProxy. Resolution failures are reported, never silently dropped.",
      request: {
        body: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: z.object({
                package: z.string().openapi({ format: 'binary', description: 'The Basemap export ZIP package (basemap.json + thumbnail binary).' }),
              }),
            },
          },
        },
      },
      responses: { 200: { description: 'OK', ...json(schemas.importReview) }, 400: badRequest },
    },
    {
      method: 'get',
      path: '/basemaps/{basemapId}',
      operationId: 'getBasemap',
      tags,
      summary: 'Get a single Basemap',
      request: { params },
      responses: { 200: { description: 'OK', ...json(schemas.basemap) }, 404: notFound },
    },
    {
      method: 'put',
      path: '/basemaps/{basemapId}',
      operationId: 'updateBasemap',
      tags,
      summary: 'Fully replace a Basemap',
      request: { params, body: { required: true, ...json(schemas.writeInput) } },
      responses: { 200: { description: 'OK', ...json(schemas.basemap) }, 400: badRequest, 404: notFound },
    },
    {
      method: 'delete',
      path: '/basemaps/{basemapId}',
      operationId: 'deleteBasemap',
      tags,
      summary: 'Delete a Basemap',
      request: { params },
      responses: { 204: { description: 'No Content' }, 404: notFound },
    },
    {
      method: 'get',
      path: '/basemaps/{basemapId}/export',
      operationId: 'exportBasemap',
      tags,
      summary: 'Export a Basemap as a self-contained, portable ZIP package (configuration + thumbnail binary; no Raster tiles/data).',
      request: { params },
      responses: {
        200: { description: 'OK', content: { 'application/zip': { schema: z.string().openapi({ format: 'binary' }) } } },
        404: notFound,
      },
    },
  ];
  routes.forEach((route) => registry.registerPath(route));
}

// ---------------------------------------------------------------------------------------------------
// Equivalence guard
// ---------------------------------------------------------------------------------------------------

// Keywords that only document a schema. `discriminator` is a hint derived from the oneOf branches
// (which are compared), and it can only be emitted when the branches are named components.
const DOCUMENTATION_KEYWORDS = new Set(['description', 'title', 'example', 'examples', 'externalDocs', 'discriminator']);

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Inlines every `$ref`, drops documentation-only keywords and unwraps single-element `allOf` wrappers. */
function resolveSchema(node: JsonValue, components: Record<string, JsonValue>, stack: string[] = []): JsonValue {
  if (Array.isArray(node)) {
    return node.map((item) => resolveSchema(item, components, stack));
  }
  if (!isJsonObject(node)) {
    return node;
  }
  const ref = node.$ref;
  if (typeof ref === 'string') {
    const name = ref.replace('#/components/schemas/', '');
    const target = components[name];
    if (target === undefined || stack.includes(name)) {
      throw new Error(`cannot resolve ${ref}`);
    }
    return resolveSchema(target, components, [...stack, name]);
  }
  const resolved: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DOCUMENTATION_KEYWORDS.has(key)) {
      continue;
    }
    if (key === 'properties' && isJsonObject(value)) {
      // property NAMES are data, not keywords: a property called "description" must be kept
      resolved[key] = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, resolveSchema(schema, components, stack)]));
      continue;
    }
    resolved[key] = resolveSchema(value, components, stack);
  }
  // `allOf: [{ $ref }, { description }]` is how a documented reference is emitted; once documentation is
  // dropped, the empty member and then a single-member wrapper mean nothing
  if (Array.isArray(resolved.allOf)) {
    resolved.allOf = resolved.allOf.filter((member) => !isJsonObject(member) || Object.keys(member).length > 0);
  }
  const allOf = resolved.allOf;
  if (Object.keys(resolved).length === 1 && Array.isArray(allOf) && allOf.length === 1 && allOf[0] !== undefined) {
    return allOf[0];
  }
  return resolved;
}

/** The fully resolved JSON schema a Zod schema produces, exactly as it would appear in openapi3.yaml. */
function toResolvedJsonSchema(schema: ZodTypeAny): JsonValue {
  const SUBJECT = '__subject';
  const registry = new OpenAPIRegistry();
  registry.register(SUBJECT, schema);
  const { components } = new OpenApiGeneratorV3(registry.definitions).generateComponents();
  const schemas = (components?.schemas ?? {}) as Record<string, JsonValue>;
  const subject = schemas[SUBJECT];
  if (subject === undefined) {
    throw new Error('zod-to-openapi did not emit the subject schema');
  }
  return resolveSchema(subject, schemas);
}

function describeValue(value: JsonValue | undefined): string {
  return value === undefined ? 'missing' : JSON.stringify(value);
}

function findFirstDifference(composed: JsonValue | undefined, reference: JsonValue | undefined, path: string): string | undefined {
  if (Array.isArray(composed) && Array.isArray(reference)) {
    if (composed.length !== reference.length) {
      return `${path}: ${composed.length} item(s) vs ${reference.length} in the reference`;
    }
    for (let index = 0; index < composed.length; index++) {
      const difference = findFirstDifference(composed[index], reference[index], `${path}/${index}`);
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  if (isJsonObject(composed) && isJsonObject(reference)) {
    const keys = [...new Set([...Object.keys(composed), ...Object.keys(reference)])].sort();
    for (const key of keys) {
      const difference = findFirstDifference(composed[key], reference[key], `${path}/${key}`);
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  return JSON.stringify(composed) === JSON.stringify(reference)
    ? undefined
    : `${path}: ${describeValue(composed)} vs ${describeValue(reference)} in the reference`;
}

/**
 * Throws unless every composed schema produces exactly the same (resolved) JSON schema as the schema it
 * stands for: same properties, required fields, types, enums, bounds, patterns, nested schemas and union
 * branches. Only documentation keywords may differ.
 */
function assertSchemasEquivalent(equivalences: readonly SchemaEquivalence[]): void {
  for (const { name, composed, reference } of equivalences) {
    const difference = findFirstDifference(toResolvedJsonSchema(composed), toResolvedJsonSchema(reference), '');
    if (difference !== undefined) {
      throw new Error(
        `OpenAPI schema "${name}" no longer matches the Zod schema it documents (${difference || '/'}). ` +
          'Update the composition in openapi/document.cts to follow the app-shared schema.'
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------------

/**
 * OpenAPI 3.0 has no `null` type. zod-to-openapi@7 renders `z.null()` as a bare `{ nullable: true }`,
 * which Ajv (express-openapi-validator) refuses to compile ("nullable" cannot be used without "type").
 * Rewrites exactly that shape into a schema that only admits `null`.
 */
function rewriteNullSchemas(node: JsonValue): JsonValue {
  if (Array.isArray(node)) {
    return node.map(rewriteNullSchemas);
  }
  if (!isJsonObject(node)) {
    return node;
  }
  const keys = Object.keys(node);
  if (keys.length === 1 && node.nullable === true) {
    return { type: 'object', nullable: true, enum: [null] };
  }
  return Object.fromEntries(keys.map((key) => [key, rewriteNullSchemas(node[key] as JsonValue)]));
}

async function buildOpenApiDocument(): Promise<OpenApiDocument> {
  await extendEsmZod();
  const registry = new OpenAPIRegistry();
  const schemas = registerSchemas(registry);
  assertSchemasEquivalent(schemas.equivalences);
  registerPaths(registry, schemas);

  const document = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: OPENAPI_VERSION,
    info: {
      title: 'basemap-management',
      description:
        'Persistence and domain operations for Basemaps (ordered compositions of map layers) consumed by the MapColonies Main App and other REST clients.',
      // deliberately not package.json's version: release bumps must not invalidate the committed artifact
      version: '1.0.0',
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    security: [{}],
  });
  return rewriteNullSchemas(document as unknown as JsonValue) as unknown as OpenApiDocument;
}

/** Deterministic YAML text of the document, formatted with the repository's prettier settings. */
async function serializeOpenApiDocument(document: OpenApiDocument, filePath: string): Promise<string> {
  const yaml = require('js-yaml') as typeof JsYaml;
  const prettier = require('prettier') as typeof Prettier;
  const body = yaml.dump(document, { noRefs: true, lineWidth: -1, sortKeys: false });
  const options = (await prettier.resolveConfig(filePath)) ?? {};
  return prettier.format(`${GENERATED_FILE_HEADER}\n${body}`, { ...options, parser: 'yaml', filepath: filePath });
}

const documentModule = {
  OPENAPI_VERSION,
  GENERATED_FILE_HEADER,
  extendEsmZod,
  registerSchemas,
  toResolvedJsonSchema,
  assertSchemasEquivalent,
  rewriteNullSchemas,
  buildOpenApiDocument,
  serializeOpenApiDocument,
};
module.exports = documentModule;

/** Type of `require('openapi/document.cts')`: this file is CommonJS, so it exports through `module.exports`. */
export type DocumentModule = typeof documentModule;
export type OpenApiDocument = ReturnType<InstanceType<typeof OpenApiGeneratorV3>['generateDocument']>;

/** A composed (OpenAPI-only) schema and the app-shared / service schema it must be identical to. */
export interface SchemaEquivalence {
  name: string;
  composed: ZodTypeAny;
  reference: ZodTypeAny;
}

export interface ComposedSchemas {
  writeInput: ZodTypeAny;
  basemap: ZodTypeAny;
  importReview: ZodTypeAny;
  equivalences: SchemaEquivalence[];
}
