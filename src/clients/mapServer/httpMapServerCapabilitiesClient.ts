import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { WmtsClient, type CapabilityWMTS } from '@map-colonies/wmts-client';
import { SERVICES } from '@common/constants';
import type { IBasemapManagementEnv } from '@common/env';
import type { IMapServerCapabilitiesClient } from './mapServerCapabilitiesClient';

const WMTS_CAPABILITIES_PATH = '/wmts/1.0.0/WMTSCapabilities.xml';

@injectable()
export class HttpMapServerCapabilitiesClient implements IMapServerCapabilitiesClient {
  private readonly wmtsClient: WmtsClient;

  public constructor(@inject(SERVICES.BASEMAP_MANAGEMENT_ENV) env: IBasemapManagementEnv, @inject(SERVICES.LOGGER) logger: Logger) {
    const baseUrl = env.mapServer.url.replace(/\/+$/, '');
    const capabilitiesUrl = baseUrl.endsWith(WMTS_CAPABILITIES_PATH) ? baseUrl : `${baseUrl}${WMTS_CAPABILITIES_PATH}`;
    this.wmtsClient = new WmtsClient(logger, capabilitiesUrl);
  }

  public async getCapabilities(): Promise<CapabilityWMTS[]> {
    return this.wmtsClient.GetCapabilities();
  }
}
