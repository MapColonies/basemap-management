import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect } from 'vitest';
import { StubBlobStorageClient } from '@src/clients/blobStorage/stubBlobStorageClient';

describe('StubBlobStorageClient', () => {
  it('stores the buffer in memory and returns a memory:// URL keyed by the given key', async () => {
    const client = new StubBlobStorageClient(await jsLogger({ enabled: false }));

    const { url } = await client.upload({ key: 'basemaps/thumbnails/abc.png', body: Buffer.from('hello'), contentType: 'image/png' });

    expect(url).toBe('memory://basemaps/thumbnails/abc.png');
  });
});
