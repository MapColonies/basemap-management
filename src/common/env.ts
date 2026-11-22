import { z } from 'zod';
import type { ConfigType } from './config';

const BASEMAP_MOCK_DATA = 'BASEMAP_MOCK_DATA';
const INJECTION_TYPES = ['header', 'queryparam'];

const basemapManagementConfigSchema = z.object({
  configServer: z.object({
    url: z.string(),
    configName: z.string().min(1),
    schemaId: z.string().min(1),
  }),
  rasterCatalog: z.object({
    url: z.string(),
    exposureType: z.enum(['SERVICE', 'ROUTE']),
  }),
  mapServer: z.object({
    url: z.string(),
    exposureType: z.enum(['SERVICE', 'ROUTE']),
  }),
  accessToken: z.object({
    attributeName: z.string().min(1),
    injectionType: z.string().refine((value) => INJECTION_TYPES.includes(value.toLowerCase()), {
      message: 'must be "header" or "queryParam"',
    }),
    tokenValue: z.string(),
  }),
  uploadLimits: z.object({
    importPackageMaxSizeBytes: z.coerce.number().finite().positive(),
  }),
});

type BasemapManagementConfig = z.infer<typeof basemapManagementConfigSchema>;

interface IBasemapManagementEnv extends BasemapManagementConfig {
  mockData: boolean;
}

function parseStrictBoolean(name: string, value: string | undefined): boolean {
  if (value === undefined || value === 'false') {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  throw new Error(`invalid ${name} environment value "${value}" - expected "true" or "false"`);
}

function getBasemapManagementEnv(config: Pick<ConfigType, 'getAll'>): IBasemapManagementEnv {
  const result = basemapManagementConfigSchema.safeParse(config.getAll());
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`invalid basemap-management configuration - ${details}`);
  }
  return {
    ...result.data,
    mockData: parseStrictBoolean(BASEMAP_MOCK_DATA, process.env[BASEMAP_MOCK_DATA]),
  };
}

export { getBasemapManagementEnv };
export type { IBasemapManagementEnv };
