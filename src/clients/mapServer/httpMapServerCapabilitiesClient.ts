import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { WmtsClient, type CapabilityWMTS } from '@map-colonies/wmts-client';
import { SERVICES } from '@common/constants';
import type { IBasemapManagementEnv } from '@common/env';
import { createRedactor, getTokenInjection, REDACTED, withTokenQueryParam } from '../accessToken';
import type { IMapServerCapabilitiesClient } from './mapServerCapabilitiesClient';

const WMTS_CAPABILITIES_PATH = '/wmts/1.0.0/WMTSCapabilities.xml';

function injectWmtsPath(urlString: string): string {
  const url = new URL(urlString);
  if (!url.pathname.endsWith(WMTS_CAPABILITIES_PATH)) {
    url.pathname = url.pathname.replace(/\/+$/, '') + WMTS_CAPABILITIES_PATH;
  }
  return url.toString();
}

function createRedactingLogger(logger: Logger, redact: (value: string) => string): Logger {
  const redactUnknown = (value: unknown): unknown => (typeof value === 'string' ? redact(value) : value);
  return logger.child(
    {},
    {
      serializers: {
        err: (err: unknown) => {
          const { name, message, code, status } = (err ?? {}) as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
          const responseStatus = (err as { response?: { status?: unknown } } | undefined)?.response?.status;
          return { type: name, message: redactUnknown(message), code, status: responseStatus ?? status };
        },
        url: redactUnknown,
        msgError: redactUnknown,
        reqConfig: () => REDACTED,
      },
    }
  );
}

@injectable()
export class HttpMapServerCapabilitiesClient implements IMapServerCapabilitiesClient {
  private readonly wmtsClient: WmtsClient;
  private readonly redact: (value: string) => string;

  public constructor(@inject(SERVICES.BASEMAP_MANAGEMENT_ENV) env: IBasemapManagementEnv, @inject(SERVICES.LOGGER) logger: Logger) {
    const { mapServer, accessToken } = env;
    const injection = getTokenInjection(mapServer.exposureType, accessToken);
    if (injection === 'header') {
      logger.warn({ msg: 'accessToken.injectionType "header" is not applied to WMTS capabilities requests (same as catalog-web-app-bff)' });
    }
    this.redact = createRedactor(injection, accessToken);
    let capabilitiesUrl = WMTS_CAPABILITIES_PATH;
    if (URL.canParse(mapServer.url)) {
      capabilitiesUrl = injectWmtsPath(injection === 'queryParam' ? withTokenQueryParam(mapServer.url, accessToken) : mapServer.url);
    }
    this.wmtsClient = new WmtsClient(createRedactingLogger(logger, this.redact), capabilitiesUrl);
  }

  public async getCapabilities(): Promise<CapabilityWMTS[]> {
    try {
      return await this.wmtsClient.GetCapabilities();
    } catch (error) {
      if (error instanceof Error) {
        error.message = this.redact(error.message);
        if (error.stack !== undefined) {
          error.stack = this.redact(error.stack);
        }
      }
      throw error;
    }
  }
}
