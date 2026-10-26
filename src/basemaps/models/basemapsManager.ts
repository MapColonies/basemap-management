import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { NotFoundError } from '@common/errors';
import { CONFIG_SERVER_CLIENT, type IConfigServerClient } from '@src/clients/configServer/configServerClient';
import { applyDefaultRoles, assertSingleOwnerPerRole } from './defaultRolePolicy';
import { validateBasemapWriteInput } from './basemapValidation';
import { CatalogResourceResolver, type SourceResolver } from './catalogResourceResolver';
import type { IBasemap, IBasemapLayerInput, IBasemapLayerOutput, IBasemapWriteInput, IPersistedBasemap } from './types';

@injectable()
class BasemapsManager {
  private writeQueue: Promise<unknown> = Promise.resolve();

  public constructor(
    @inject(CONFIG_SERVER_CLIENT) private readonly configServerClient: IConfigServerClient,
    @inject(CatalogResourceResolver) private readonly resolver: CatalogResourceResolver,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {}

  public async list(): Promise<IBasemap[]> {
    const basemaps = await this.listPersisted();
    const resolve = this.resolver.createScope();
    return Promise.all(basemaps.map(async (basemap) => this.toOutput(basemap, resolve)));
  }

  public async listPersisted(): Promise<IPersistedBasemap[]> {
    const { document } = await this.configServerClient.getLatest();
    return document.basemaps;
  }

  public async getById(id: string): Promise<IBasemap> {
    return this.toOutput(await this.getPersistedById(id));
  }

  public async create(input: IBasemapWriteInput): Promise<IBasemap> {
    validateBasemapWriteInput(input);

    const created = await this.mutate((basemaps) => {
      const id = randomUUID();
      const persisted: IPersistedBasemap = {
        id,
        name: input.name,
        thumbnail: input.thumbnail,
        isCurrent: false,
        isForPreview: false,
        layers: input.layers,
      };
      const next = applyDefaultRoles([...basemaps, persisted], id, { isCurrent: input.isCurrent, isForPreview: input.isForPreview });
      this.logger.info({ msg: 'basemap created', basemapId: id });
      return { next, result: getOrThrow(next, id) };
    });
    return this.toOutput(created);
  }

  public async update(id: string, input: IBasemapWriteInput): Promise<IBasemap> {
    validateBasemapWriteInput(input);

    const updated = await this.mutate((basemaps) => {
      if (!basemaps.some((candidate) => candidate.id === id)) {
        throw new NotFoundError(`basemap "${id}" was not found`);
      }
      const merged = basemaps.map((candidate) => (candidate.id === id ? { ...input, id } : candidate));
      const next = applyDefaultRoles(merged, id, { isCurrent: input.isCurrent, isForPreview: input.isForPreview });
      this.logger.info({ msg: 'basemap updated', basemapId: id });
      return { next, result: getOrThrow(next, id) };
    });
    return this.toOutput(updated);
  }

  public async remove(id: string): Promise<void> {
    await this.mutate((basemaps) => {
      if (!basemaps.some((candidate) => candidate.id === id)) {
        throw new NotFoundError(`basemap "${id}" was not found`);
      }
      this.logger.info({ msg: 'basemap deleted', basemapId: id });
      return { next: basemaps.filter((candidate) => candidate.id !== id), result: undefined };
    });
  }

  private async getPersistedById(id: string): Promise<IPersistedBasemap> {
    const basemap = (await this.listPersisted()).find((candidate) => candidate.id === id);
    if (!basemap) {
      throw new NotFoundError(`basemap "${id}" was not found`);
    }
    return basemap;
  }

  private async toOutput(basemap: IPersistedBasemap, resolve: SourceResolver = this.resolver.createScope()): Promise<IBasemap> {
    const layers = await Promise.all(basemap.layers.map(async (layer) => this.toOutputLayer(layer, resolve)));
    return {
      id: basemap.id,
      name: basemap.name,
      thumbnail: basemap.thumbnail,
      isCurrent: basemap.isCurrent,
      isForPreview: basemap.isForPreview,
      layers,
    };
  }

  private async toOutputLayer(layer: IBasemapLayerInput, resolve: SourceResolver): Promise<IBasemapLayerOutput> {
    const source = await resolve(layer.source);
    return { id: layer.id, order: layer.order, opacity: layer.opacity, shouldBeUsedInModelDraping: layer.shouldBeUsedInModelDraping, source };
  }

  /**
   * Runs `fn` against the latest document under the in-process write lock, asserts role invariants
   * on the result, persists it, and returns `fn`'s result. `fn` may throw (e.g. NotFoundError) - the
   * lock is released either way and nothing is persisted when it does.
   */
  private async mutate<T>(fn: (basemaps: IPersistedBasemap[]) => { next: IPersistedBasemap[]; result: T }): Promise<T> {
    const run = async (): Promise<T> => {
      const { document, version } = await this.configServerClient.getLatest();
      const { next, result } = fn(document.basemaps);
      assertSingleOwnerPerRole(next);
      await this.configServerClient.save({ basemaps: next }, version);
      return result;
    };

    const resultPromise = this.writeQueue.then(run, run);
    this.writeQueue = resultPromise.then(
      () => undefined,
      () => undefined
    );
    return resultPromise;
  }
}

function getOrThrow(basemaps: IPersistedBasemap[], id: string): IPersistedBasemap {
  const basemap = basemaps.find((candidate) => candidate.id === id);
  /* istanbul ignore next -- defensive: `id` was just inserted/confirmed present by the caller */
  if (!basemap) {
    throw new NotFoundError(`basemap "${id}" was not found`);
  }
  return basemap;
}

export { BasemapsManager };
