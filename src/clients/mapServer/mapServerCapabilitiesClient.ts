import type { CapabilityModelType } from '@src/basemaps/models/catalogTypes';

export interface IMapServerCapabilitiesClient {
  getCapabilities: () => Promise<CapabilityModelType[]>;
}

export const MAP_SERVER_CAPABILITIES_CLIENT = Symbol('MapServerCapabilitiesClient');
