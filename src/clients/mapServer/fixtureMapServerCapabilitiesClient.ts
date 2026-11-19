import type { CapabilityWMTS } from '@map-colonies/wmts-client';
import type { IMapServerCapabilitiesClient } from './mapServerCapabilitiesClient';

export class FixtureMapServerCapabilitiesClient implements IMapServerCapabilitiesClient {
  public constructor(public capabilities: CapabilityWMTS[]) {}

  public async getCapabilities(): Promise<CapabilityWMTS[]> {
    return Promise.resolve(this.capabilities);
  }
}
