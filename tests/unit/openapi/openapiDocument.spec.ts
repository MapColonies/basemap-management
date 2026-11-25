import { readFileSync } from 'node:fs';
import path from 'node:path';
import express, { json } from 'express';
import { getErrorHandlerMiddleware } from '@map-colonies/error-express-handler';
import { middleware as openApiValidatorMiddleware } from 'express-openapi-validator';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { BasemapWriteInputSchema, SourceType } from '@map-colonies/app-shared';
import { loadDocumentModule } from './documentModule';

type DocumentModule = ReturnType<typeof loadDocumentModule>;
type OpenApiDocument = Awaited<ReturnType<DocumentModule['buildOpenApiDocument']>>;
type JsonObject = Record<string, unknown>;

const OPENAPI_FILE = path.join(process.cwd(), 'openapi3.yaml');
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;

const documentModule = loadDocumentModule();
let document: OpenApiDocument;

function schemaOf(name: string): JsonObject {
  const schema = document.components?.schemas?.[name];
  if (schema === undefined) {
    throw new Error(`component schema "${name}" is missing`);
  }
  return schema as JsonObject;
}

function at(node: unknown, ...keys: (string | number)[]): unknown {
  return keys.reduce<unknown>((current, key) => (current as Record<string | number, unknown> | undefined)?.[key], node);
}

function collectBareNullableSchemas(node: unknown, found: string[] = [], pointer = ''): string[] {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectBareNullableSchemas(item, found, `${pointer}/${index}`));
  } else if (typeof node === 'object' && node !== null) {
    const entries = Object.entries(node);
    if (entries.length === 1 && (node as JsonObject).nullable === true) {
      found.push(pointer);
    }
    entries.forEach(([key, value]) => collectBareNullableSchemas(value, found, `${pointer}/${key}`));
  }
  return found;
}

describe('generated OpenAPI document', () => {
  beforeAll(async () => {
    document = await documentModule.buildOpenApiDocument();
  });

  describe('generation', () => {
    it('should generate an OpenAPI 3.0 document with all seven operations', () => {
      expect(document.openapi).toBe('3.0.1');

      const operations = Object.entries(document.paths).flatMap(([route, item]) =>
        Object.entries(item as JsonObject).map(
          ([method, operation]) => `${method.toUpperCase()} ${route} ${(operation as JsonObject).operationId as string}`
        )
      );

      expect(operations.sort()).toEqual(
        [
          'DELETE /basemaps/{basemapId} deleteBasemap',
          'GET /basemaps listBasemaps',
          'GET /basemaps/{basemapId} getBasemap',
          'GET /basemaps/{basemapId}/export exportBasemap',
          'POST /basemaps createBasemap',
          'POST /basemaps/import/validate validateBasemapImport',
          'PUT /basemaps/{basemapId} updateBasemap',
        ].sort()
      );
    });

    it('should document the multipart ZIP upload and the ZIP download as binaries', () => {
      const upload = at(document.paths, '/basemaps/import/validate', 'post', 'requestBody', 'content', 'multipart/form-data', 'schema');

      expect(upload).toMatchObject({ type: 'object', required: ['package'], properties: { package: { type: 'string', format: 'binary' } } });
      expect(at(document.paths, '/basemaps/{basemapId}/export', 'get', 'responses', '200', 'content', 'application/zip', 'schema')).toEqual({
        type: 'string',
        format: 'binary',
      });
    });

    it('should reference the shared path parameter and error responses', () => {
      expect(document.components?.parameters?.basemapId).toMatchObject({
        name: 'basemapId',
        in: 'path',
        required: true,
        schema: { $ref: '#/components/schemas/basemapId' },
      });
      expect(schemaOf('basemapId')).toEqual({ type: 'string' });
      expect(at(document.paths, '/basemaps/{basemapId}', 'put', 'responses')).toMatchObject({
        '400': { $ref: '#/components/responses/badRequest' },
        '404': { $ref: '#/components/responses/notFound' },
      });
      expect(document.components?.responses?.badRequest).toMatchObject({
        content: { 'application/json': { schema: { $ref: '#/components/schemas/error' } } },
      });
      expect(document.security).toEqual([{}]);
    });

    it('should not contain a type-less `{ nullable: true }` schema (OpenAPI 3.0 null rewrite)', () => {
      expect(collectBareNullableSchemas(document)).toEqual([]);
      expect(at(schemaOf('basemapLayerOutput'), 'properties', 'source', 'anyOf', 1, 'properties', 'layer')).toEqual({
        type: 'object',
        nullable: true,
        enum: [null],
      });
    });

    it('should rewrite only bare nullable schemas', () => {
      expect(documentModule.rewriteNullSchemas({ a: { nullable: true }, b: { type: 'string', nullable: true }, c: [{ nullable: true }] })).toEqual({
        a: { type: 'object', nullable: true, enum: [null] },
        b: { type: 'string', nullable: true },
        c: [{ type: 'object', nullable: true, enum: [null] }],
      });
    });

    it('should publish the thumbnail url as a plain string (the app-shared non-blank `.refine()` is not expressible)', () => {
      expect(at(schemaOf('basemapThumbnail'), 'properties', 'url')).toEqual({ type: 'string' });
    });
  });

  describe('reusable components', () => {
    it.each([
      ['basemapWriteInput', ['properties', 'thumbnail'], 'basemapThumbnail'],
      ['basemapWriteInput', ['properties', 'layers', 'items'], 'basemapLayerInput'],
      ['basemapLayerInput', ['properties', 'source'], 'basemapLayerSourceInput'],
      ['basemapLayerSourceInput', ['oneOf', 0], 'catalogResourceLayerSource'],
      ['basemapLayerSourceInput', ['oneOf', 1], 'externalLayerSource'],
      ['catalogResourceLayerSource', ['properties', 'uniqueness'], 'rasterUniqueness'],
      ['externalLayerSource', ['properties', 'details'], 'externalLayerDetails'],
      ['basemap', ['properties', 'thumbnail'], 'basemapThumbnail'],
      ['basemap', ['properties', 'layers', 'items'], 'basemapLayerOutput'],
      ['basemapLayerOutput', ['properties', 'source', 'anyOf', 0, 'properties', 'capabilities'], 'capability'],
      ['importReview', ['properties', 'layers', 'items'], 'basemapLayerOutput'],
      ['importReview', ['properties', 'currentRoleConflict', 'allOf', 0], 'importReviewRoleConflict'],
    ])('should reference %s %j as a $ref to %s', (component, pointer, target) => {
      expect(at(schemaOf(component), ...pointer)).toEqual({ $ref: `#/components/schemas/${target}` });
    });

    it('should keep the input layer source a discriminated oneOf', () => {
      expect(schemaOf('basemapLayerSourceInput').discriminator).toEqual({
        propertyName: 'type',
        mapping: {
          [SourceType.CATALOG_RESOURCE]: '#/components/schemas/catalogResourceLayerSource',
          [SourceType.EXTERNAL]: '#/components/schemas/externalLayerSource',
        },
      });
    });

    it('should describe the output layer source as the three runtime branches (resolved, unresolved, external)', () => {
      const branches = at(schemaOf('basemapLayerOutput'), 'properties', 'source', 'anyOf') as JsonObject[];

      expect(branches.map((branch) => [at(branch, 'properties', 'type', 'enum', 0), at(branch, 'properties', 'status', 'enum', 0)])).toEqual([
        [SourceType.CATALOG_RESOURCE, 'RESOLVED'],
        [SourceType.CATALOG_RESOURCE, 'UNRESOLVED'],
        [SourceType.EXTERNAL, 'RESOLVED'],
      ]);
    });
  });

  describe('determinism', () => {
    it('should serialize identically on every run', async () => {
      const first = await documentModule.serializeOpenApiDocument(await documentModule.buildOpenApiDocument(), OPENAPI_FILE);
      const second = await documentModule.serializeOpenApiDocument(await documentModule.buildOpenApiDocument(), OPENAPI_FILE);

      expect(second).toBe(first);
    });

    it('should match the committed openapi3.yaml (run `npm run generate:openapi` if this fails)', async () => {
      const generated = await documentModule.serializeOpenApiDocument(document, OPENAPI_FILE);

      expect(readFileSync(OPENAPI_FILE, 'utf8')).toBe(generated);
      expect(generated.startsWith(documentModule.GENERATED_FILE_HEADER)).toBe(true);
    });
  });

  describe('express-openapi-validator with the committed openapi3.yaml', () => {
    const app = express();
    app.use(json());
    app.use(openApiValidatorMiddleware({ apiSpec: OPENAPI_FILE, validateRequests: true, validateResponses: false }));
    app.post('/basemaps', (_req, res) => {
      res.status(HTTP_CREATED).json({});
    });
    app.get('/basemaps/:basemapId', (_req, res) => {
      res.status(HTTP_OK).json({});
    });
    app.use(getErrorHandlerMiddleware());

    const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const body = (url: string): JsonObject => ({
      name: 'b',
      thumbnail: { url, width: 128, height: 128 },
      isCurrent: false,
      isForPreview: false,
      layers: [],
    });

    it.each([
      'https://data-service.example.com/pvc/files/basemaps/thumbnails/a.png',
      `data:image/png;base64,${PNG_1X1}`,
      'foo',
      '/pvc/files/a.png',
      'memory://basemaps/thumbnails/a.png',
    ])('should accept the non-blank thumbnail url %j, like the Zod schema', async (url) => {
      expect(BasemapWriteInputSchema.safeParse(body(url)).success).toBe(true);
      expect((await request(app).post('/basemaps').send(body(url))).status).toBe(HTTP_CREATED);
    });

    // Known gap: the `.refine()` exists only in Zod, so a blank url passes the validator and is rejected later by the service.
    it.each(['', '   '])('should let the blank thumbnail url %j through, although the Zod schema rejects it', async (url) => {
      expect(BasemapWriteInputSchema.safeParse(body(url)).success).toBe(false);
      expect((await request(app).post('/basemaps').send(body(url))).status).toBe(HTTP_CREATED);
    });

    it('should still reject a non-string thumbnail url', async () => {
      expect(
        (
          await request(app)
            .post('/basemaps')
            .send({ ...body(''), thumbnail: { url: 1, width: 128, height: 128 } })
        ).status
      ).toBe(HTTP_BAD_REQUEST);
    });

    it('should still reject unknown routes and methods', async () => {
      expect((await request(app).get('/nope')).status).toBe(HTTP_NOT_FOUND);
      expect((await request(app).patch('/basemaps/x')).status).toBe(HTTP_METHOD_NOT_ALLOWED);
    });
  });
});
