import type { CapabilityWMTS } from '@map-colonies/wmts-client';

export interface IMapServerCapabilitiesClient {
  getCapabilities: () => Promise<CapabilityWMTS[]>;
}

export const MAP_SERVER_CAPABILITIES_CLIENT = Symbol('MapServerCapabilitiesClient');
