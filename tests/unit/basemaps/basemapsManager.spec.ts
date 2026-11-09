import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { Domain, ProductType, SourceType } from '@map-colonies/types';
import { BasemapsManager } from '@src/basemaps/models/basemapsManager';
import type { IConfigServerClient, IConfigServerDocument } from '@src/clients/configServer/configServerClient';
import { CatalogResourceResolver } from '@src/basemaps/models/catalogResourceResolver';
import { type IBasemap, type IBasemapLayerInput, type IBasemapWriteInput, type IPersistedBasemap } from '@src/basemaps/models/types';

function fakeLogger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn() } as unknown as Logger;
}

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

  // eslint-disable-next-line @typescript-eslint/require-await
  public async getLatest(): Promise<{ document: IConfigServerDocument; version: number | undefined }> {
    return { document: this.document, version: this.version === 0 ? undefined : this.version };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
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

  describe('persisted layer shape', () => {
    const UNIQUENESS = { productId: '12345', productType: ProductType.ORTHOPHOTO };
    const layerFromRead = {
      id: 'l1',
      order: 0,
      opacity: 1,
      source: {
        type: SourceType.CATALOG_RESOURCE,
        domain: Domain.RASTER,
        uniqueness: { ...UNIQUENESS, extra: 'x' },
        status: 'RESOLVED',
        layer: { id: 'record-1' },
        capabilities: { id: 'cap-1' },
      },
    } as unknown as IBasemapLayerInput;
    const external: IBasemapLayerInput = {
      id: 'l2',
      order: 1,
      opacity: 0.5,
      shouldBeUsedInModelDraping: true,
      source: { type: SourceType.EXTERNAL, details: { protocol: 'WMTS', name: 'n', url: 'https://example.com', layer: 'ortho', style: 's' } },
    };
    const PERSISTED_CATALOG_SOURCE = { type: SourceType.CATALOG_RESOURCE, domain: Domain.RASTER, uniqueness: UNIQUENESS };

    it('stores only the input contract on create - read-only fields are dropped, external details are kept whole', async () => {
      await manager.create(writeInput({ layers: [layerFromRead, external] }));

      const [stored] = configServerClient.document.basemaps;

      expect(stored?.layers).toEqual([{ id: 'l1', order: 0, opacity: 1, source: PERSISTED_CATALOG_SOURCE }, { ...external }]);
    });

    it('stores only the input contract on update', async () => {
      const created = await manager.create(writeInput());

      await manager.update(created.id, writeInput({ layers: [layerFromRead] }));

      const [stored] = configServerClient.document.basemaps;

      expect(stored?.layers).toEqual([{ id: 'l1', order: 0, opacity: 1, source: PERSISTED_CATALOG_SOURCE }]);
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

  describe('malformed persisted data', () => {
    const CORRUPT_ENTRY = { id: 'corrupt-1', name: 42 } as unknown as IPersistedBasemap;

    it('#list skips a corrupt entry, keeps valid ones, and logs it with its id', async () => {
      const created = await manager.create(writeInput({ name: 'A' }));
      configServerClient.document.basemaps = [...configServerClient.document.basemaps, CORRUPT_ENTRY];
      const logger = fakeLogger();
      const loggingManager = new BasemapsManager(configServerClient, await noopResolver(), logger);

      const basemaps = await loggingManager.list();

      expect(basemaps.map((basemap) => basemap.id)).toEqual([created.id]);
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ basemapId: 'corrupt-1' }));
    });

    it('#getById fails closed (not 404) for a present-but-corrupt entry', async () => {
      configServerClient.document.basemaps = [CORRUPT_ENTRY];

      await expect(manager.getById('corrupt-1')).rejects.toMatchObject({ statusCode: 500 });
    });

    it('#getById still returns 404 for a truly missing id, not the corrupt-data error', async () => {
      configServerClient.document.basemaps = [CORRUPT_ENTRY];

      await expect(manager.getById('does-not-exist')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('a write preserves a pre-existing corrupt sibling entry untouched rather than dropping it', async () => {
      configServerClient.document.basemaps = [CORRUPT_ENTRY];

      await manager.create(writeInput({ name: 'A' }));

      expect(configServerClient.document.basemaps).toContainEqual(CORRUPT_ENTRY);
      expect(configServerClient.document.basemaps).toHaveLength(2);
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
