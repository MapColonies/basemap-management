import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, it, expect, beforeAll } from 'vitest';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { generateBasemapOpenApiSchemas } from '@src/basemaps/models/openapi/basemapOpenApiSchemas';

async function patchEsmZodForVitest(): Promise<void> {
  const esmZod = (await import('zod')) as { z: Parameters<typeof extendZodWithOpenApi>[0] };
  extendZodWithOpenApi(esmZod.z);
}

type SchemaNode = Record<string, unknown>;

const DOMAIN_SCHEMA_KEYS = [
  'rasterUniqueness',
  'externalLayerDetails',
  'catalogResourceLayerSource',
  'externalLayerSource',
  'basemapLayerSourceInput',
  'externalLayerSourceOutput',
  'status',
  'capability',
  'layerRasterRecord',
  'catalogResourceLayerSourceOutput',
  'basemapLayerSourceOutput',
  'basemapThumbnail',
  'basemapLayerInput',
  'basemapLayerOutput',
  'basemap',
  'basemapWriteInput',
] as const;

function resolveRefs(node: unknown, schemas: Record<string, SchemaNode>, seen: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(item, schemas, seen));
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }
  const obj = node as SchemaNode;
  const ref = obj.$ref;
  if (typeof ref === 'string') {
    const prefix = '#/components/schemas/';
    if (!ref.startsWith(prefix)) {
      throw new Error(`Unexpected $ref outside components.schemas: "${ref}"`);
    }
    const name = ref.slice(prefix.length);
    if (seen.has(name)) {
      throw new Error(`Circular $ref chain while resolving openapi3.yaml: ${[...seen, name].join(' -> ')}`);
    }
    const target = schemas[name];
    if (target === undefined) {
      throw new Error(`openapi3.yaml has a $ref to an undefined schema: "${name}"`);
    }
    return resolveRefs(target, schemas, new Set([...seen, name]));
  }
  const result: SchemaNode = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = resolveRefs(value, schemas, seen);
  }
  return result;
}

const WMTS_CAPABILITY_PROPERTY_KEYS = ['id', 'style', 'format', 'tileMatrixSet', 'url'] as const;
const WMTS_STYLE_ITEM_PROPERTY_KEYS = ['value', 'isDefault'] as const;

function hasExactPropertyKeys(node: SchemaNode, expectedKeys: readonly string[]): boolean {
  if (node.type !== 'object' || typeof node.properties !== 'object' || node.properties === null) {
    return false;
  }
  const keys = Object.keys(node.properties).sort();
  return JSON.stringify(keys) === JSON.stringify([...expectedKeys].sort());
}

function isWmtsCapabilityShape(node: SchemaNode): boolean {
  return hasExactPropertyKeys(node, WMTS_CAPABILITY_PROPERTY_KEYS);
}

function isWmtsStyleItemShape(node: SchemaNode): boolean {
  return hasExactPropertyKeys(node, WMTS_STYLE_ITEM_PROPERTY_KEYS);
}

const BASEMAP_THUMBNAIL_PROPERTY_KEYS = ['url', 'width', 'height'] as const;

function isBasemapThumbnailShape(node: SchemaNode): boolean {
  return hasExactPropertyKeys(node, BASEMAP_THUMBNAIL_PROPERTY_KEYS);
}

function stripThumbnailUrlFormatException(node: SchemaNode): SchemaNode {
  const properties = node.properties as Record<string, SchemaNode>;
  const url = properties.url;
  if (url === undefined || url.format !== 'uri' || Object.keys(url).length !== 2) {
    return node;
  }
  return { ...node, properties: { ...properties, url: { type: url.type } } };
}

function stripMinConstraintsDeep(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripMinConstraintsDeep);
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }
  const result: SchemaNode = {};
  for (const [key, value] of Object.entries(node as SchemaNode)) {
    if (key === 'minLength' || key === 'minItems') {
      continue;
    }
    result[key] = stripMinConstraintsDeep(value);
  }
  return result;
}

function isNullOnly(node: SchemaNode): boolean {
  const keys = Object.keys(node);
  return keys.length === 1 && keys[0] === 'nullable' && node.nullable === true;
}

function tryFlattenNullTolerantUnion(branches: SchemaNode[]): SchemaNode | undefined {
  if (branches.length !== 2) {
    return undefined;
  }
  const [first, second] = branches as [SchemaNode, SchemaNode];
  if (first.type !== 'object' || second.type !== 'object') {
    return undefined;
  }
  const firstProps = (first.properties ?? {}) as Record<string, SchemaNode>;
  const secondProps = (second.properties ?? {}) as Record<string, SchemaNode>;
  const keys = new Set([...Object.keys(firstProps), ...Object.keys(secondProps)]);
  if (keys.size !== Object.keys(firstProps).length || keys.size !== Object.keys(secondProps).length) {
    return undefined;
  }

  const mergedProperties: Record<string, SchemaNode> = {};
  for (const key of keys) {
    const a = firstProps[key] as SchemaNode;
    const b = secondProps[key] as SchemaNode;
    if (JSON.stringify(a) === JSON.stringify(b)) {
      mergedProperties[key] = a;
    } else if (isNullOnly(b)) {
      mergedProperties[key] = { ...a, nullable: true };
    } else if (isNullOnly(a)) {
      mergedProperties[key] = { ...b, nullable: true };
    } else if (Array.isArray(a.enum) && Array.isArray(b.enum) && a.type === b.type) {
      mergedProperties[key] = { ...a, enum: [...(a.enum as unknown[]), ...(b.enum as unknown[])] };
    } else {
      return undefined;
    }
  }

  const requiredA = new Set((first.required as string[] | undefined) ?? []);
  const requiredB = new Set((second.required as string[] | undefined) ?? []);
  if (requiredA.size !== requiredB.size || [...requiredA].some((key) => !requiredB.has(key))) {
    return undefined;
  }

  return { type: 'object', required: [...requiredA].sort(), properties: mergedProperties };
}

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normalize);
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }
  const obj = node as SchemaNode;
  const result: SchemaNode = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'description' || key === 'discriminator') {
      continue;
    }
    if (key === 'additionalProperties' && value === true) {
      continue;
    }
    result[key] = normalize(value);
  }

  if (result.type === 'number' && Array.isArray(result.enum) && (result.enum as unknown[]).every((value) => Number.isInteger(value))) {
    result.type = 'integer';
  }
  if (Array.isArray(result.required)) {
    result.required = [...(result.required as string[])].sort();
  }
  if (Array.isArray(result.enum) && result.enum.every((value) => typeof value === 'string' || typeof value === 'number')) {
    result.enum = [...result.enum].sort();
  }

  const branchesKey = 'oneOf' in result ? 'oneOf' : 'anyOf' in result ? 'anyOf' : undefined;
  if (branchesKey !== undefined) {
    const branches = result[branchesKey] as SchemaNode[];
    const flattened = tryFlattenNullTolerantUnion(branches);
    if (flattened !== undefined) {
      return flattened;
    }
    delete result[branchesKey];
    result.oneOf = branches;
  }

  if (isWmtsStyleItemShape(result)) {
    return { ...(stripMinConstraintsDeep(result) as SchemaNode), required: ['value'] };
  }
  if (isWmtsCapabilityShape(result)) {
    return { ...(stripMinConstraintsDeep(result) as SchemaNode), required: ['id'] };
  }
  if (isBasemapThumbnailShape(result)) {
    return stripThumbnailUrlFormatException(result);
  }

  if (Object.keys(result).length === 0) {
    return { nullable: true };
  }

  return result;
}

describe('basemap openapi schemas vs. zod schemas (drift check)', () => {
  let yamlSchemas: Record<string, SchemaNode>;
  let zodSchemas: Record<string, SchemaNode>;

  beforeAll(async () => {
    await patchEsmZodForVitest();
    const openapiPath = path.join(process.cwd(), 'openapi3.yaml');
    const spec = load(fs.readFileSync(openapiPath, 'utf8')) as { components?: { schemas?: Record<string, SchemaNode> } };
    yamlSchemas = spec.components?.schemas ?? {};
    zodSchemas = generateBasemapOpenApiSchemas();
  });

  it.each(DOMAIN_SCHEMA_KEYS)('%s: openapi3.yaml matches the zod schema it documents', (key) => {
    expect(yamlSchemas[key], `openapi3.yaml has no "${key}" schema under components.schemas`).toBeDefined();
    expect(zodSchemas[key], `no zod schema was registered for "${key}" - see basemapOpenApiSchemas.ts`).toBeDefined();

    const fromYaml = normalize(resolveRefs(yamlSchemas[key], yamlSchemas, new Set()));
    const fromZod = normalize(zodSchemas[key]);

    expect(fromYaml).toEqual(fromZod);
  });
});
