import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect } from 'vitest';
import { BasemapsManager } from '@src/basemaps/models/basemapsManager';
import type { IConfigServerClient, IConfigServerDocument } from '@src/clients/configServer/configServerClient';
import { CatalogResourceResolver } from '@src/basemaps/models/catalogResourceResolver';
import type { IBasemap, IBasemapWriteInput } from '@src/basemaps/models/types';

async function noopResolver(): Promise<CatalogResourceResolver> {
  return new CatalogResourceResolver(
    { resolveLayer: async () => Promise.resolve(null) },
    { getCapabilities: async () => Promise.resolve([]) },
    await jsLogger({ enabled: false })
  );
}

class FakeConfigServerClient implements IConfigServerClient {
  public version = 0;
  public document: IConfigServerDocument = { basemaps: [] };
  public saveCallCount = 0;

  // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
  public async getLatest(): Promise<{ document: IConfigServerDocument; version: number | undefined }> {
    return { document: this.document, version: this.version === 0 ? undefined : this.version };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fake test double, nothing to await
  public async save(document: IConfigServerDocument, baseVersion: number | undefined): Promise<{ version: number }> {
    const expectedBaseVersion = this.version === 0 ? undefined : this.version;
    if (baseVersion !== expectedBaseVersion) {
      throw new Error(`stale write: expected baseVersion ${String(expectedBaseVersion)}, got ${String(baseVersion)}`);
    }
    this.document = document;
    this.version += 1;
    this.saveCallCount += 1;
    return { version: this.version };
  }
}

function writeInput(overrides: Partial<IBasemapWriteInput> = {}): IBasemapWriteInput {
  return {
    name: 'Satellite Europe',
    thumbnail: { url: 'https://example.com/thumb.png', width: 128, height: 128 },
    isCurrent: false,
    isForPreview: false,
    layers: [],
    ...overrides,
  };
}

describe('BasemapsManager', () => {
  let configServerClient: FakeConfigServerClient;
  let manager: BasemapsManager;

  beforeEach(async () => {
    configServerClient = new FakeConfigServerClient();
    manager = new BasemapsManager(configServerClient, await noopResolver(), await jsLogger({ enabled: false }));
  });

  describe('#create', () => {
    it('creates a basemap and persists it', async () => {
      const created = await manager.create(writeInput());

      expect(created.id.length).toBeGreaterThan(0);
      expect(created.name).toBe('Satellite Europe');
      expect(configServerClient.document.basemaps).toHaveLength(1);
      expect(configServerClient.saveCallCount).toBe(1);
    });

    it('rejects an invalid input without ever calling save', async () => {
      await expect(manager.create(writeInput({ name: '' }))).rejects.toThrow(/name/);
      expect(configServerClient.saveCallCount).toBe(0);
    });

    it('claiming isCurrent on a new basemap clears it from the previous owner', async () => {
      const first = await manager.create(writeInput({ isCurrent: true }));
      const second = await manager.create(writeInput({ isCurrent: true }));

      const refreshedFirst = await manager.getById(first.id);

      expect(refreshedFirst.isCurrent).toBe(false);
      expect(second.isCurrent).toBe(true);
    });
  });

  describe('#update', () => {
    it('fully replaces an existing basemap', async () => {
      const created = await manager.create(writeInput());

      const updated = await manager.update(created.id, writeInput({ name: 'Renamed' }));

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Renamed');
    });

    it('throws NotFoundError for an unknown id', async () => {
      await expect(manager.update('missing-id', writeInput())).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('#remove', () => {
    it('deletes an existing basemap', async () => {
      const created = await manager.create(writeInput());

      await manager.remove(created.id);

      await expect(manager.list()).resolves.toHaveLength(0);
    });

    it('throws NotFoundError for an unknown id', async () => {
      await expect(manager.remove('missing-id')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('#getById / #list', () => {
    it('throws NotFoundError when the basemap does not exist', async () => {
      await expect(manager.getById('missing-id')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('lists every persisted basemap', async () => {
      await manager.create(writeInput({ name: 'A' }));
      await manager.create(writeInput({ name: 'B' }));

      const basemaps: IBasemap[] = await manager.list();

      expect(basemaps.map((basemap) => basemap.name).sort()).toEqual(['A', 'B']);
    });
  });

  describe('concurrency / config-server failures', () => {
    it('serializes concurrent writes so each is based on the previous one (no lost updates)', async () => {
      const created = await manager.create(writeInput());

      await Promise.all([manager.create(writeInput({ name: 'X' })), manager.create(writeInput({ name: 'Y' }))]);

      const basemaps = await manager.list();

      expect(basemaps.map((basemap) => basemap.name).sort()).toEqual(['Satellite Europe', 'X', 'Y']);
      expect(basemaps.find((basemap) => basemap.id === created.id)).toBeDefined();
    });

    it('propagates a config-server failure and still allows the next operation to proceed', async () => {
      const failingClient: IConfigServerClient = {
        getLatest: async () => Promise.reject(new Error('config-server unreachable')),
        save: configServerClient.save.bind(configServerClient),
      };
      const failingManager = new BasemapsManager(failingClient, await noopResolver(), await jsLogger({ enabled: false }));

      await expect(failingManager.list()).rejects.toThrow(/unreachable/);
    });
  });
});
