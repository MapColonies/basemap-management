import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { UpstreamServiceError } from '@common/errors';
import type { IBasemapManagementEnv } from '@common/env';
import type { IConfigServerClient, IConfigServerDocument, IConfigServerDocumentWithVersion } from './configServerClient';

const HTTP_NOT_FOUND = 404;
const API_CONFIG_PATH = '/api/config';
const LATEST_VERSION = 'latest';

function parseConfigServerReadResponse(body: unknown, configName: string): IConfigServerDocumentWithVersion {
  if (typeof body !== 'object' || body === null) {
    throw new UpstreamServiceError('config-server returned a non-object response body');
  }
  const configs = (body as { configs?: unknown }).configs;
  if (!Array.isArray(configs)) {
    throw new UpstreamServiceError('config-server response is missing a "configs" array');
  }

  const entry = configs.find((candidate): candidate is { configName: unknown; config?: unknown; version?: unknown } => {
    return typeof candidate === 'object' && candidate !== null && (candidate as { configName?: unknown }).configName === configName;
  });
  if (!entry) {
    return { document: { basemaps: [] }, version: undefined };
  }

  const rawDocument = entry.config as { basemaps?: unknown } | undefined;
  const basemaps = Array.isArray(rawDocument?.basemaps) ? (rawDocument.basemaps as IConfigServerDocument['basemaps']) : [];
  const version = typeof entry.version === 'number' ? entry.version : undefined;

  return { document: { basemaps }, version };
}

@injectable()
export class HttpConfigServerClient implements IConfigServerClient {
  private readonly baseUrl: string;
  private readonly configName: string;
  private readonly schemaId: string;

  public constructor(
    @inject(SERVICES.BASEMAP_MANAGEMENT_ENV) env: IBasemapManagementEnv,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.baseUrl = env.configServer.url.replace(/\/+$/, '');
    this.configName = env.configServer.configName;
    this.schemaId = env.configServer.schemaId;
  }

  public async getLatest(): Promise<IConfigServerDocumentWithVersion> {
    const url = new URL(`${this.baseUrl}${API_CONFIG_PATH}`);
    url.searchParams.set('config_name', this.configName);
    url.searchParams.set('schema_id', this.schemaId);
    url.searchParams.set('version', LATEST_VERSION);

    const response = await fetch(url).catch((error: unknown) => {
      throw new UpstreamServiceError(`config-server request failed: ${String(error)}`);
    });

    if (response.status === HTTP_NOT_FOUND) {
      this.logger.info({ msg: 'no basemaps document exists yet in config-server, starting from an empty list', configName: this.configName });
      return { document: { basemaps: [] }, version: undefined };
    }
    if (!response.ok) {
      throw new UpstreamServiceError(`config-server returned ${response.status} while fetching the "${this.configName}" document`);
    }

    const body: unknown = await response.json();
    return parseConfigServerReadResponse(body, this.configName);
  }

  public async save(document: IConfigServerDocument, baseVersion: number | undefined): Promise<{ version: number }> {
    const firstVersion = 1;
    const nextVersion = baseVersion === undefined ? firstVersion : baseVersion + 1;

    const response = await fetch(`${this.baseUrl}${API_CONFIG_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        configName: this.configName,
        schemaId: this.schemaId,
        version: nextVersion,
        config: document,
      }),
    }).catch((error: unknown) => {
      throw new UpstreamServiceError(`config-server write failed: ${String(error)}`);
    });

    if (!response.ok) {
      throw new UpstreamServiceError(`config-server returned ${response.status} while writing the "${this.configName}" document`);
    }

    return { version: nextVersion };
  }
}
