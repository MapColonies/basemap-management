import { randomUUID } from 'node:crypto';
import type { Logger } from '@map-colonies/js-logger';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import type { TypedRequestHandlers } from '@openapi';
import { SERVICES } from '@common/constants';
import { ValidationError } from '@common/errors';
import { getUploadedFile } from '@common/multipart';
import type { IBasemapManagementEnv } from '@common/env';
import { BLOB_STORAGE_CLIENT, type IBlobStorageClient } from '@src/clients/blobStorage/blobStorageClient';
import { sniffImage } from '../thumbnails/imageFormat';
import { THUMBNAIL_DIMENSION_PIXELS, type IBasemapWriteInput } from '../models/types';
import { BasemapsManager } from '../models/basemapsManager';

function toWriteInput(body: unknown): IBasemapWriteInput {
  return body as IBasemapWriteInput;
}

@injectable()
export class BasemapsController {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(BasemapsManager) private readonly manager: BasemapsManager,
    @inject(BLOB_STORAGE_CLIENT) private readonly blobStorageClient: IBlobStorageClient,
    @inject(SERVICES.BASEMAP_MANAGEMENT_ENV) private readonly basemapManagementEnv: IBasemapManagementEnv
  ) {}

  public listBasemaps: TypedRequestHandlers['listBasemaps'] = async (req, res, next) => {
    try {
      const basemaps = await this.manager.list();
      return res.status(httpStatus.OK).json(basemaps);
    } catch (error) {
      this.logger.error({ msg: 'failed to list basemaps', err: error });
      return next(error);
    }
  };

  public getBasemap: TypedRequestHandlers['getBasemap'] = async (req, res, next) => {
    try {
      const basemap = await this.manager.getById(req.params.basemapId);
      return res.status(httpStatus.OK).json(basemap);
    } catch (error) {
      this.logger.error({ msg: 'failed to get basemap', basemapId: req.params.basemapId, err: error });
      return next(error);
    }
  };

  public createBasemap: TypedRequestHandlers['createBasemap'] = async (req, res, next) => {
    try {
      const created = await this.manager.create(toWriteInput(req.body));
      return res.status(httpStatus.CREATED).json(created);
    } catch (error) {
      this.logger.error({ msg: 'failed to create basemap', err: error });
      return next(error);
    }
  };

  public updateBasemap: TypedRequestHandlers['updateBasemap'] = async (req, res, next) => {
    try {
      const updated = await this.manager.update(req.params.basemapId, toWriteInput(req.body));
      return res.status(httpStatus.OK).json(updated);
    } catch (error) {
      this.logger.error({ msg: 'failed to update basemap', basemapId: req.params.basemapId, err: error });
      return next(error);
    }
  };

  public deleteBasemap: TypedRequestHandlers['deleteBasemap'] = async (req, res, next) => {
    try {
      await this.manager.remove(req.params.basemapId);
      return res.status(httpStatus.NO_CONTENT).send();
    } catch (error) {
      this.logger.error({ msg: 'failed to delete basemap', basemapId: req.params.basemapId, err: error });
      return next(error);
    }
  };

  public uploadBasemapThumbnail: TypedRequestHandlers['uploadBasemapThumbnail'] = async (req, res, next) => {
    try {
      const file = getUploadedFile(req, 'thumbnail');
      if (file.buffer.length > this.basemapManagementEnv.uploadLimits.thumbnailMaxSizeBytes) {
        throw new ValidationError(
          `the thumbnail exceeds the maximum allowed size of ${this.basemapManagementEnv.uploadLimits.thumbnailMaxSizeBytes} bytes`
        );
      }
      const sniffed = sniffImage(file.buffer);
      if (!sniffed) {
        throw new ValidationError('the uploaded file is not a valid PNG or WebP image');
      }
      if (sniffed.width !== THUMBNAIL_DIMENSION_PIXELS || sniffed.height !== THUMBNAIL_DIMENSION_PIXELS) {
        throw new ValidationError(
          `the thumbnail must be exactly ${THUMBNAIL_DIMENSION_PIXELS}x${THUMBNAIL_DIMENSION_PIXELS} pixels, got ${sniffed.width}x${sniffed.height}`
        );
      }

      const extension = sniffed.mimeType === 'image/png' ? 'png' : 'webp';
      const key = `basemaps/thumbnails/${randomUUID()}.${extension}`;
      const { url } = await this.blobStorageClient.upload({ key, body: file.buffer, contentType: sniffed.mimeType });

      return res.status(httpStatus.CREATED).json({ url, width: THUMBNAIL_DIMENSION_PIXELS, height: THUMBNAIL_DIMENSION_PIXELS });
    } catch (error) {
      this.logger.error({ msg: 'failed to upload basemap thumbnail', err: error });
      return next(error);
    }
  };
}
