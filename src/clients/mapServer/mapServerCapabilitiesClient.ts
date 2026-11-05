import type { Capability } from '@map-colonies/types';

export interface IMapServerCapabilitiesClient {
  getCapabilities: () => Promise<Capability[]>;
}

export const MAP_SERVER_CAPABILITIES_CLIENT = Symbol('MapServerCapabilitiesClient');
