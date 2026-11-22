import { createRequire } from 'node:module';
import path from 'node:path';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as zodModule from 'zod';
import type { AnyZodObject, ZodTypeAny } from 'zod';
import * as shared from '@map-colonies/app-shared';
import { loadDocumentModule } from './documentModule';

const documentModule = loadDocumentModule();
const { z } = createRequire(path.join(process.cwd(), 'package.json'))('zod') as typeof zodModule;

interface Overrides {
  thumbnail?: ZodTypeAny;
  uniqueness?: ZodTypeAny;
  catalogSource?: AnyZodObject;
  externalSource?: AnyZodObject;
  sourceInput?: ZodTypeAny;
  layerInput?: ZodTypeAny;
}

function composeWriteInput(overrides: Overrides = {}): ZodTypeAny {
  const registry = new OpenAPIRegistry();
  const thumbnail = overrides.thumbnail ?? registry.register('basemapThumbnail', shared.BasemapThumbnailSchema);
  const uniqueness = overrides.uniqueness ?? registry.register('rasterUniqueness', shared.RasterUniquenessSchema);
  const details = registry.register('externalLayerDetails', shared.ExternalLayerDetailsSchema);
  const catalogSource =
    overrides.catalogSource ?? registry.register('catalogResourceLayerSource', shared.CatalogResourceLayerSourceSchema.extend({ uniqueness }));
  const externalSource = overrides.externalSource ?? registry.register('externalLayerSource', shared.ExternalLayerSourceSchema.extend({ details }));
  const sourceInput =
    overrides.sourceInput ?? registry.register('basemapLayerSourceInput', z.discriminatedUnion('type', [catalogSource, externalSource]));
  const layerInput = overrides.layerInput ?? registry.register('basemapLayerInput', shared.BasemapLayerInputSchema.extend({ source: sourceInput }));
  return registry.register('basemapWriteInput', shared.BasemapWriteInputSchema.extend({ thumbnail, layers: z.array(layerInput) }));
}

function assertEquivalent(composed: ZodTypeAny, reference: ZodTypeAny = shared.BasemapWriteInputSchema): void {
  documentModule.assertSchemasEquivalent([{ name: 'basemapWriteInput', composed, reference }]);
}

describe('OpenAPI schema equivalence guard', () => {
  beforeAll(async () => {
    await documentModule.extendEsmZod();
  });

  describe('accepts', () => {
    it('should accept every composition the generator actually uses', () => {
      const { equivalences } = documentModule.registerSchemas(new OpenAPIRegistry());

      expect(equivalences.map(({ name }) => name)).toEqual([
        'catalogResourceLayerSource',
        'externalLayerSource',
        'basemapLayerSourceInput',
        'basemapLayerInput',
        'basemapWriteInput',
        'basemapLayerOutput',
        'basemap',
        'importReview',
      ]);
      expect(() => documentModule.assertSchemasEquivalent(equivalences)).not.toThrow();
    });

    it('should accept the composed write input although it is made of $refs', () => {
      expect(() => assertEquivalent(composeWriteInput())).not.toThrow();
    });

    it('should ignore documentation-only differences', () => {
      const thumbnail = shared.BasemapThumbnailSchema.describe('a different description');

      expect(() => assertEquivalent(composeWriteInput({ thumbnail }))).not.toThrow();
    });
  });

  describe('detects', () => {
    it('should detect a missing required field in a nested component', () => {
      const thumbnail = new OpenAPIRegistry().register('basemapThumbnail', shared.BasemapThumbnailSchema.partial({ height: true }));

      expect(() => assertEquivalent(composeWriteInput({ thumbnail }))).toThrow(/"basemapWriteInput".*\/properties\/thumbnail\/required/);
    });

    it('should detect a changed enum deep inside a union branch', () => {
      const catalogSource = shared.CatalogResourceLayerSourceSchema.extend({ domain: z.enum(['RASTER', 'VECTOR']) });

      expect(() => assertEquivalent(composeWriteInput({ catalogSource }))).toThrow(
        /\/properties\/layers\/items\/properties\/source\/oneOf\/0\/properties\/domain\/enum/
      );
    });

    it('should detect a changed maximum', () => {
      const layerInput = shared.BasemapLayerInputSchema.extend({
        opacity: z.number().min(0).max(2),
        source: shared.BasemapLayerSourceInputSchema,
      });

      expect(() => assertEquivalent(composeWriteInput({ layerInput }))).toThrow(/\/properties\/opacity\/maximum: 2 vs 1/);
    });

    it('should detect a changed minimum', () => {
      const layerInput = shared.BasemapLayerInputSchema.extend({ order: z.number().int().min(1) });

      expect(() => assertEquivalent(composeWriteInput({ layerInput }))).toThrow(/\/properties\/order\/minimum: 1 vs 0/);
    });

    it('should detect a changed nested schema behind a $ref', () => {
      const uniqueness = new OpenAPIRegistry().register('rasterUniqueness', shared.RasterUniquenessSchema.extend({ productId: z.string() }));

      expect(() => assertEquivalent(composeWriteInput({ uniqueness }))).toThrow(/\/properties\/uniqueness\/properties\/productId\/nullable/);
    });

    it('should detect a changed string constraint (the thumbnail URL pattern)', () => {
      const thumbnail = shared.BasemapThumbnailSchema.extend({ url: z.string().url() });

      expect(() => assertEquivalent(composeWriteInput({ thumbnail }))).toThrow(/\/properties\/thumbnail\/properties\/url\/pattern/);
    });

    it('should detect a missing union branch', () => {
      const catalogSource = shared.CatalogResourceLayerSourceSchema;
      const sourceInput = z.discriminatedUnion('type', [catalogSource]);

      expect(() => assertEquivalent(composeWriteInput({ sourceInput }))).toThrow(/\/oneOf: 1 item\(s\) vs 2/);
    });

    it('should detect a changed union branch', () => {
      const externalSource = shared.ExternalLayerSourceSchema.extend({ type: z.literal('EXTERNAL_V2') });

      expect(() => assertEquivalent(composeWriteInput({ externalSource }))).toThrow(/\/oneOf\/1\/properties\/type\/enum/);
    });

    it('should detect a union turned into a non-discriminated union', () => {
      const sourceInput = z.union([shared.CatalogResourceLayerSourceSchema, shared.ExternalLayerSourceSchema]);

      expect(() => assertEquivalent(composeWriteInput({ sourceInput }))).toThrow(/\/(anyOf|oneOf)/);
    });

    it('should detect drift on the app-shared (reference) side as well', () => {
      const reference = shared.BasemapWriteInputSchema.extend({ isCurrent: z.boolean().optional() });

      expect(() => assertEquivalent(composeWriteInput(), reference)).toThrow(/\/required/);
    });

    it('should compare a property called "description" instead of dropping it as documentation', () => {
      expect(() =>
        documentModule.assertSchemasEquivalent([
          { name: 'subject', composed: z.object({ description: z.string() }), reference: z.object({ description: z.number() }) },
        ])
      ).toThrow(/\/properties\/description\/type/);
    });
  });
});
