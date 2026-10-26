import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import type { IBlobStorageClient, IUploadBlobParams } from './blobStorageClient';

/**
 * In-memory stand-in for the real blob/data-storage service (no confirmed contract exists yet - see
 * README). Keeps uploaded buffers only for the lifetime of the process and returns a `memory://` URL
 * that is NOT servable by anything outside this process. Every call logs a warning so this never goes
 * unnoticed in logs/ops. Swap for a real `IBlobStorageClient` implementation once the storage
 * contract is confirmed; do not use beyond local development/demos.
 */
@injectable()
export class StubBlobStorageClient implements IBlobStorageClient {
  private readonly store = new Map<string, Buffer>();

  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  public async upload(params: IUploadBlobParams): Promise<{ url: string }> {
    this.store.set(params.key, params.body);
    const url = `memory://${params.key}`;
    this.logger.warn({
      msg: 'StubBlobStorageClient used - this is an in-memory stand-in, not real persistent storage. Replace before production use.',
      key: params.key,
      url,
    });
    return Promise.resolve({ url });
  }
}
