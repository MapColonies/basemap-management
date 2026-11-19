import { UpstreamServiceError } from '@common/errors';
import type { IConfigServerClient, IConfigServerDocumentWithVersion, IRawConfigServerDocument } from './configServerClient';

export class InMemoryConfigServerClient implements IConfigServerClient {
  public document: IRawConfigServerDocument;
  public version: number | undefined;

  public constructor(seed: IRawConfigServerDocument = { basemaps: [] }) {
    this.document = { basemaps: structuredClone(seed.basemaps) };
    this.version = seed.basemaps.length > 0 ? 1 : undefined;
  }

  public async getLatest(): Promise<IConfigServerDocumentWithVersion> {
    return Promise.resolve({ document: structuredClone(this.document), version: this.version });
  }

  public async save(document: IRawConfigServerDocument, baseVersion: number | undefined): Promise<{ version: number }> {
    if (baseVersion !== this.version) {
      return Promise.reject(new UpstreamServiceError(`stale write: expected base version ${String(this.version)}, got ${String(baseVersion)}`));
    }
    this.document = structuredClone(document);
    this.version = (this.version ?? 0) + 1;
    return Promise.resolve({ version: this.version });
  }
}
