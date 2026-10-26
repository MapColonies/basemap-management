import type { Logger } from '@map-colonies/js-logger';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import type { TypedRequestHandlers } from '@openapi';
import { SERVICES } from '@common/constants';
import { getUploadedFile } from '@common/multipart';
import { BasemapImportExportManager } from '../models/basemapImportExportManager';

const ZIP_CONTENT_TYPE = 'application/zip';

@injectable()
export class BasemapImportExportController {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(BasemapImportExportManager) private readonly manager: BasemapImportExportManager
  ) {}

  public exportBasemap: TypedRequestHandlers['exportBasemap'] = async (req, res, next) => {
    try {
      const zipBuffer = await this.manager.exportBasemap(req.params.basemapId);
      res.status(httpStatus.OK).set('Content-Type', ZIP_CONTENT_TYPE);
      res.set('Content-Disposition', `attachment; filename="${req.params.basemapId}.zip"`);
      // The generated response type for a `format: binary` body is `string` - express's untyped
      // `.end()` (unlike `.json()`/`.send()`) is not narrowed by it, so sending a Buffer here is safe.
      return res.end(zipBuffer);
    } catch (error) {
      this.logger.error({ msg: 'failed to export basemap', basemapId: req.params.basemapId, err: error });
      return next(error);
    }
  };

  public validateBasemapImport: TypedRequestHandlers['validateBasemapImport'] = async (req, res, next) => {
    try {
      const file = getUploadedFile(req, 'package');
      const review = await this.manager.validateImport(file.buffer);
      return res.status(httpStatus.OK).json(review);
    } catch (error) {
      this.logger.error({ msg: 'failed to validate basemap import package', err: error });
      return next(error);
    }
  };
}
