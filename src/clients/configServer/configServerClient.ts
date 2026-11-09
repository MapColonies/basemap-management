import type { IPersistedBasemap } from '@src/basemaps/models/types';

export interface IConfigServerDocument {
  basemaps: IPersistedBasemap[];
}

export interface IRawConfigServerDocument {
  basemaps: unknown[];
}

export interface IConfigServerDocumentWithVersion {
  document: IRawConfigServerDocument;
  /** `undefined` means no document has ever been written for this configName yet. */
  version: number | undefined;
}

export interface IConfigServerClient {
  getLatest: () => Promise<IConfigServerDocumentWithVersion>;

  save: (document: IConfigServerDocument, baseVersion: number | undefined) => Promise<{ version: number }>;
}

export const CONFIG_SERVER_CLIENT = Symbol('ConfigServerClient');
