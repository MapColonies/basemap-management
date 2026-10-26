import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { NotFoundError, UpstreamServiceError } from '@common/errors';
import { readBasemapPackage } from '../packaging/basemapPackageReader';
import { writeBasemapPackage } from '../packaging/basemapPackageWriter';
import { findCurrentOwner, findPreviewOwner } from './defaultRolePolicy';
import { BasemapsManager } from './basemapsManager';
import { CatalogResourceResolver, type SourceResolver } from './catalogResourceResolver';
import { SourceTypeOutput, type IBasemapLayerInput, type IImportReview, type IImportReviewLayer, type IPortableBasemap } from './types';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/webp': 'webp',
};

@injectable()
export class BasemapImportExportManager {
  public constructor(
    @inject(BasemapsManager) private readonly basemapsManager: BasemapsManager,
    @inject(CatalogResourceResolver) private readonly resolver: CatalogResourceResolver,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {}

  public async exportBasemap(basemapId: string): Promise<Buffer> {
    const basemaps = await this.basemapsManager.listPersisted();
    const basemap = basemaps.find((candidate) => candidate.id === basemapId);
    if (!basemap) {
      throw new NotFoundError(`basemap "${basemapId}" was not found`);
    }

    const thumbnailResponse = await fetch(basemap.thumbnail.url).catch((error: unknown) => {
      throw new UpstreamServiceError(`failed to retrieve the thumbnail for basemap "${basemapId}": ${String(error)}`);
    });
    if (!thumbnailResponse.ok) {
      throw new UpstreamServiceError(`failed to retrieve the thumbnail for basemap "${basemapId}": HTTP ${thumbnailResponse.status}`);
    }
    const thumbnailBuffer = Buffer.from(await thumbnailResponse.arrayBuffer());
    const contentType = thumbnailResponse.headers.get('content-type') ?? '';
    const extension = EXTENSION_BY_MIME_TYPE[contentType] ?? 'bin';

    const portable: IPortableBasemap = {
      name: basemap.name,
      isCurrent: basemap.isCurrent,
      isForPreview: basemap.isForPreview,
      thumbnail: { file: `thumbnail.${extension}`, width: basemap.thumbnail.width, height: basemap.thumbnail.height },
      layers: basemap.layers,
    };

    this.logger.info({ msg: 'basemap exported', basemapId });
    return writeBasemapPackage(portable, thumbnailBuffer);
  }

  public async validateImport(archiveBuffer: Buffer): Promise<IImportReview> {
    const { portable, thumbnail } = await readBasemapPackage(archiveBuffer);
    const existingBasemaps = await this.basemapsManager.listPersisted();

    const resolve = this.resolver.createScope();
    const layers = await Promise.all(portable.layers.map(async (layer) => this.toReviewLayer(layer, resolve)));

    const currentOwner = portable.isCurrent ? findCurrentOwner(existingBasemaps) : undefined;
    const previewOwner = portable.isForPreview ? findPreviewOwner(existingBasemaps) : undefined;

    this.logger.info({ msg: 'basemap import package validated', name: portable.name, layerCount: layers.length });

    return {
      name: portable.name,
      isCurrent: portable.isCurrent,
      isForPreview: portable.isForPreview,
      currentRoleConflict: currentOwner ? { basemapId: currentOwner.id, basemapName: currentOwner.name } : undefined,
      previewRoleConflict: previewOwner ? { basemapId: previewOwner.id, basemapName: previewOwner.name } : undefined,
      thumbnail: {
        included: true,
        width: thumbnail.width,
        height: thumbnail.height,
        mimeType: thumbnail.mimeType,
        dataBase64: thumbnail.buffer.toString('base64'),
      },
      layers,
    };
  }

  private async toReviewLayer(layer: IBasemapLayerInput, resolve: SourceResolver): Promise<IImportReviewLayer> {
    const source = await resolve(layer.source);
    return {
      status: source.type === SourceTypeOutput.UNRESOLVED_CATALOG_RESOURCE ? 'UNRESOLVED' : 'RESOLVED',
      id: layer.id,
      order: layer.order,
      opacity: layer.opacity,
      shouldBeUsedInModelDraping: layer.shouldBeUsedInModelDraping,
      source,
    };
  }
}
