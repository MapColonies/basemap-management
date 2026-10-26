import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { UpstreamServiceError } from '@common/errors';
import type { IBasemapManagementEnv } from '@common/env';
import type { CapabilityModelType } from '@src/basemaps/models/catalogTypes';
import type { IMapServerCapabilitiesClient } from './mapServerCapabilitiesClient';
import { xmlToCapabilities } from './xmlToCapabilities';

const WMTS_CAPABILITIES_PATH = '/wmts/1.0.0/WMTSCapabilities.xml';

@injectable()
export class HttpMapServerCapabilitiesClient implements IMapServerCapabilitiesClient {
  private readonly capabilitiesUrl: string;

  public constructor(
    @inject(SERVICES.BASEMAP_MANAGEMENT_ENV) env: IBasemapManagementEnv,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    const baseUrl = env.mapServer.url.replace(/\/+$/, '');
    this.capabilitiesUrl = baseUrl.endsWith(WMTS_CAPABILITIES_PATH) ? baseUrl : `${baseUrl}${WMTS_CAPABILITIES_PATH}`;
  }

  public async getCapabilities(): Promise<CapabilityModelType[]> {
    const response = await fetch(this.capabilitiesUrl).catch((error: unknown) => {
      throw new UpstreamServiceError(`MapProxy capabilities request failed: ${String(error)}`);
    });
    if (!response.ok) {
      throw new UpstreamServiceError(`MapProxy capabilities request failed: HTTP ${response.status}`);
    }
    const capabilities = xmlToCapabilities(await response.text());
    this.logger.debug({ msg: 'MapProxy capabilities fetched', layerCount: capabilities.length });
    return capabilities;
  }
}
