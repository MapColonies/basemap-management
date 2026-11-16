// eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
import zodModule = require('zod');
import { z as esmZod } from 'zod';
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import {
  RasterUniquenessSchema,
  ExternalLayerDetailsSchema,
  CatalogResourceLayerSourceSchema,
  ExternalLayerSourceSchema,
  BasemapLayerSourceInputSchema,
  BasemapThumbnailSchema,
  BasemapLayerInputSchema,
  BasemapWriteInputSchema,
  PersistedBasemapSchema,
  ResourceResolutionStatus,
} from '@map-colonies/app-shared';
import { CapabilityWMTSSchema } from '@map-colonies/wmts-client';
import { LayerRasterRecordSchema } from '@src/basemaps/models/catalogTypes';

const { z } = zodModule;

extendZodWithOpenApi(z);
extendZodWithOpenApi(esmZod);

export function generateBasemapOpenApiSchemas(): Record<string, Record<string, unknown>> {
  const registry = new OpenAPIRegistry();

  const resolved = z.literal(ResourceResolutionStatus.RESOLVED);

  const catalogResourceLayerSourceOutputSchema = CatalogResourceLayerSourceSchema.extend({
    status: z.nativeEnum(ResourceResolutionStatus),
    layer: LayerRasterRecordSchema.nullable(),
    capabilities: CapabilityWMTSSchema.nullable(),
  });
  const externalLayerSourceOutputSchema = ExternalLayerSourceSchema.extend({ status: resolved });
  const basemapLayerSourceOutputSchema = z.union([catalogResourceLayerSourceOutputSchema, externalLayerSourceOutputSchema]);
  const basemapLayerOutputSchema = BasemapLayerInputSchema.omit({ source: true }).extend({ source: basemapLayerSourceOutputSchema });

  const nonEmptyName = z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, { message: 'name must not be empty' });
  const basemapWriteInputSchema = BasemapWriteInputSchema.extend({ name: nonEmptyName });
  const basemapSchema = basemapWriteInputSchema
    .extend({ id: PersistedBasemapSchema.shape.id })
    .omit({ layers: true })
    .extend({
      layers: z.array(basemapLayerOutputSchema),
    });

  registry.register('rasterUniqueness', RasterUniquenessSchema);
  registry.register('externalLayerDetails', ExternalLayerDetailsSchema);
  registry.register('catalogResourceLayerSource', CatalogResourceLayerSourceSchema);
  registry.register('externalLayerSource', ExternalLayerSourceSchema);
  registry.register('basemapLayerSourceInput', BasemapLayerSourceInputSchema);
  registry.register('externalLayerSourceOutput', externalLayerSourceOutputSchema);
  registry.register('status', z.nativeEnum(ResourceResolutionStatus));
  registry.register('capability', CapabilityWMTSSchema.nullable());
  registry.register('layerRasterRecord', LayerRasterRecordSchema.nullable());
  registry.register('catalogResourceLayerSourceOutput', catalogResourceLayerSourceOutputSchema);
  registry.register('basemapLayerSourceOutput', basemapLayerSourceOutputSchema);
  registry.register('basemapThumbnail', BasemapThumbnailSchema);
  registry.register('basemapLayerInput', BasemapLayerInputSchema);
  registry.register('basemapLayerOutput', basemapLayerOutputSchema);
  registry.register('basemap', basemapSchema);
  registry.register('basemapWriteInput', basemapWriteInputSchema);

  const generator = new OpenApiGeneratorV3(registry.definitions);
  const { components } = generator.generateComponents();

  return (components?.schemas ?? {}) as Record<string, Record<string, unknown>>;
}
