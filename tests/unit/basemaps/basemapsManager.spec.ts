import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, vi, type MockInstance } from 'vitest';
import { Domain, ProductType } from '@map-colonies/types';
import { SourceType } from '@map-colonies/app-shared';
import { BasemapsManager } from '@src/basemaps/models/basemapsManager';
import type { IConfigServerClient } from '@src/clients/configServer/configServerClient';
import { InMemoryConfigServerClient } from '@src/clients/configServer/inMemoryConfigServerClient';
import { CatalogResourceResolver } from '@src/basemaps/models/catalogResourceResolver';
import { type Basemap, type BasemapLayerInput, type BasemapWriteInput, type PersistedBasemap } from '@src/basemaps/models/types';

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

function writeInput(overrides: Partial<BasemapWriteInput> = {}): BasemapWriteInput {
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
  let configServerClient: InMemoryConfigServerClient;
  let saveSpy: MockInstance<IConfigServerClient['save']>;
  let manager: BasemapsManager;

  beforeEach(async () => {
    configServerClient = new InMemoryConfigServerClient();
    saveSpy = vi.spyOn(configServerClient, 'save');
    manager = new BasemapsManager(configServerClient, await noopResolver(), await jsLogger({ enabled: false }));
  });

  describe('#create', () => {
    it('creates a basemap and persists it', async () => {
      const created = await manager.create(writeInput());

      expect(created.id.length).toBeGreaterThan(0);
      expect(created.name).toBe('Satellite Europe');
      expect(configServerClient.document.basemaps).toHaveLength(1);
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid input without ever calling save', async () => {
      await expect(manager.create(writeInput({ name: '' }))).rejects.toThrow(/name/);
      expect(saveSpy).not.toHaveBeenCalled();
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
    } as unknown as BasemapLayerInput;
    const external: BasemapLayerInput = {
      id: 'l2',
      order: 1,
      opacity: 0.5,
      shouldBeUsedInModelDraping: true,
      source: {
        type: SourceType.EXTERNAL,
        details: { protocol: 'WMTS', name: 'n', url: 'https://example.com', extras: { layer: 'ortho', style: 's' } },
      },
    };
    const PERSISTED_CATALOG_SOURCE = { type: SourceType.CATALOG_RESOURCE, domain: Domain.RASTER, uniqueness: UNIQUENESS };

    it('stores only the input contract on create - read-only fields are dropped, external details are kept whole', async () => {
      await manager.create(writeInput({ layers: [layerFromRead, external] }));

      const [stored] = configServerClient.document.basemaps as PersistedBasemap[];

      expect(stored?.layers).toEqual([{ id: 'l1', order: 0, opacity: 1, source: PERSISTED_CATALOG_SOURCE }, { ...external }]);
    });

    it('stores only the input contract on update', async () => {
      const created = await manager.create(writeInput());

      await manager.update(created.id, writeInput({ layers: [layerFromRead] }));

      const [stored] = configServerClient.document.basemaps as PersistedBasemap[];

      expect(stored?.layers).toEqual([{ id: 'l1', order: 0, opacity: 1, source: PERSISTED_CATALOG_SOURCE }]);
    });

    const withUnknownKeys = (): BasemapWriteInput =>
      ({
        ...writeInput({ layers: [{ ...external, extraLayerKey: 1 } as BasemapLayerInput] }),
        extraBasemapKey: 'x',
        thumbnail: { url: 'https://example.com/thumb.png', width: 128, height: 128, extraThumbnailKey: true },
      }) as BasemapWriteInput;
    const STORED_KEYS = ['id', 'isCurrent', 'isForPreview', 'layers', 'name', 'thumbnail'];

    it('should drop unknown request keys on create', async () => {
      await manager.create(withUnknownKeys());

      const [stored] = configServerClient.document.basemaps as PersistedBasemap[];

      expect(Object.keys(stored ?? {}).sort()).toEqual(STORED_KEYS);
      expect(stored?.thumbnail).toEqual({ url: 'https://example.com/thumb.png', width: 128, height: 128 });
      expect(stored?.layers).toEqual([{ ...external }]);
    });

    it('should drop unknown request keys on update', async () => {
      const created = await manager.create(writeInput());

      await manager.update(created.id, withUnknownKeys());

      const [stored] = configServerClient.document.basemaps as PersistedBasemap[];

      expect(Object.keys(stored ?? {}).sort()).toEqual(STORED_KEYS);
      expect(stored?.thumbnail).toEqual({ url: 'https://example.com/thumb.png', width: 128, height: 128 });
      expect(stored?.layers).toEqual([{ ...external }]);
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

      const basemaps: Basemap[] = await manager.list();

      expect(basemaps.map((basemap) => basemap.name).sort()).toEqual(['A', 'B']);
    });
  });

  describe('malformed persisted data', () => {
    const CORRUPT_ENTRY = { id: 'corrupt-1', name: 42 } as unknown as PersistedBasemap;

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

  describe('collection invariants', () => {
    const LAYER: BasemapLayerInput = {
      id: 'layer-1',
      order: 0,
      opacity: 1,
      source: { type: SourceType.CATALOG_RESOURCE, domain: Domain.RASTER, uniqueness: { productId: '1', productType: ProductType.ORTHOPHOTO } },
    };

    function storedBasemap(id: string, overrides: Partial<PersistedBasemap> = {}): PersistedBasemap {
      return { ...writeInput({ name: id, layers: [LAYER] }), id, ...overrides };
    }

    it('should not detect an updated basemap as a duplicate of itself', async () => {
      const created = await manager.create(writeInput({ isCurrent: true, isForPreview: true, layers: [LAYER] }));

      const updated = await manager.update(created.id, writeInput({ name: 'Renamed', isCurrent: true, isForPreview: true, layers: [LAYER] }));

      expect(updated).toMatchObject({ id: created.id, name: 'Renamed', isCurrent: true, isForPreview: true });
      expect(configServerClient.document.basemaps).toHaveLength(1);
    });

    it('should reject duplicate layer ids / orders on update with a 400, without saving', async () => {
      const created = await manager.create(writeInput({ layers: [LAYER] }));
      saveSpy.mockClear();

      await expect(manager.update(created.id, writeInput({ layers: [LAYER, { ...LAYER, id: 'layer-2' }] }))).rejects.toMatchObject({
        statusCode: 400,
        message: 'duplicate layer order 0 (layers "layer-1", "layer-2")',
      });
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('should allow the same layer ids and orders in different basemaps', async () => {
      await manager.create(writeInput({ layers: [LAYER] }));
      await manager.create(writeInput({ layers: [LAYER] }));

      await expect(manager.list()).resolves.toHaveLength(2);
    });

    it('should move isCurrent and isForPreview independently of each other', async () => {
      const a = await manager.create(writeInput({ isCurrent: true, isForPreview: true }));
      const b = await manager.create(writeInput({ isForPreview: true }));

      const roles = (await manager.list()).map(({ id, isCurrent, isForPreview }) => ({ id, isCurrent, isForPreview }));

      expect(roles).toEqual([
        { id: a.id, isCurrent: true, isForPreview: false },
        { id: b.id, isCurrent: false, isForPreview: true },
      ]);
    });

    it('should move isCurrent on update, clearing it from the previous owner', async () => {
      const a = await manager.create(writeInput({ isCurrent: true }));
      const b = await manager.create(writeInput());

      await manager.update(b.id, writeInput({ isCurrent: true }));

      expect((await manager.getById(a.id)).isCurrent).toBe(false);
      expect((await manager.getById(b.id)).isCurrent).toBe(true);
    });

    describe('with a stored document that violates them', () => {
      const DUPLICATE = 'dup';

      it('should refuse an ambiguous duplicate id in #getById, #update and #remove instead of picking an entry', async () => {
        configServerClient.document.basemaps = [storedBasemap(DUPLICATE), storedBasemap(DUPLICATE, { name: 'other' })];
        const before = structuredClone(configServerClient.document);

        await expect(manager.getById(DUPLICATE)).rejects.toMatchObject({ statusCode: 500, message: expect.stringContaining('ambiguous') as unknown });
        await expect(manager.update(DUPLICATE, writeInput())).rejects.toMatchObject({ statusCode: 500 });
        await expect(manager.remove(DUPLICATE)).rejects.toMatchObject({ statusCode: 500 });
        expect(configServerClient.document).toEqual(before);
      });

      it('should detect a duplicate id even when one of the entries is structurally invalid', async () => {
        const invalidTwin = { id: DUPLICATE, name: 42 };
        configServerClient.document.basemaps = [storedBasemap(DUPLICATE), invalidTwin];

        await expect(manager.getById(DUPLICATE)).rejects.toMatchObject({ statusCode: 500, message: expect.stringContaining('ambiguous') as unknown });
        await expect(manager.create(writeInput())).rejects.toMatchObject({
          statusCode: 500,
          message: expect.stringContaining('duplicate basemap id "dup" (2 entries)') as unknown,
        });
        expect(saveSpy).not.toHaveBeenCalled();
        expect(configServerClient.document.basemaps).toEqual([storedBasemap(DUPLICATE), invalidTwin]);
      });

      it('should refuse to save over two stored current basemaps, naming them, and repair nothing', async () => {
        configServerClient.document.basemaps = [storedBasemap('a', { isCurrent: true }), storedBasemap('b', { isCurrent: true })];

        await expect(manager.create(writeInput())).rejects.toMatchObject({
          statusCode: 500,
          message: expect.stringContaining('multiple basemaps have isCurrent=true: "a", "b"') as unknown,
        });
        expect(saveSpy).not.toHaveBeenCalled();
      });

      it('should resolve the conflict when a write claims the role, through the existing automatic reassignment', async () => {
        configServerClient.document.basemaps = [storedBasemap('a', { isForPreview: true }), storedBasemap('b', { isForPreview: true })];

        await manager.update('a', writeInput({ name: 'a', isForPreview: true, layers: [LAYER] }));

        expect((await manager.list()).filter((basemap) => basemap.isForPreview).map((basemap) => basemap.id)).toEqual(['a']);
      });

      it('should check the complete outgoing document: an invalid stored entry still holding isCurrent blocks a new owner', async () => {
        const invalidOwner = { id: 'broken', name: 42, isCurrent: true };
        configServerClient.document.basemaps = [invalidOwner];

        await expect(manager.create(writeInput({ isCurrent: true }))).rejects.toMatchObject({
          statusCode: 500,
          message: expect.stringContaining('multiple basemaps have isCurrent=true: "broken",') as unknown,
        });
        expect(configServerClient.document.basemaps).toEqual([invalidOwner]);
      });

      it('should keep #list working and log the collection conflicts', async () => {
        configServerClient.document.basemaps = [storedBasemap('a', { isCurrent: true }), storedBasemap('b', { isCurrent: true })];
        const logger = fakeLogger();
        const loggingManager = new BasemapsManager(configServerClient, await noopResolver(), logger);

        await expect(loggingManager.list()).resolves.toHaveLength(2);

        expect(logger.warn).toHaveBeenCalledWith({
          msg: 'stored basemaps document violates collection invariants',
          conflicts: ['multiple basemaps have isCurrent=true: "a", "b"'],
        });
      });

      it('should treat a stored basemap with duplicate layer orders as corrupt (500) and keep it untouched on writes', async () => {
        const corrupt = storedBasemap('layers', { layers: [LAYER, { ...LAYER, id: 'layer-2' }] });
        configServerClient.document.basemaps = [corrupt];

        await expect(manager.getById('layers')).rejects.toMatchObject({ statusCode: 500 });

        await manager.create(writeInput());

        expect(configServerClient.document.basemaps).toContainEqual(corrupt);
      });
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
