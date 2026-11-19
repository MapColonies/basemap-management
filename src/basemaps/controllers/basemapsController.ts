import type { Logger } from '@map-colonies/js-logger';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import type { TypedRequestHandlers } from '@openapi';
import { SERVICES } from '@common/constants';
import type { BasemapWriteInput } from '../models/types';
import { BasemapsManager } from '../models/basemapsManager';

function toWriteInput(body: unknown): BasemapWriteInput {
  return body as BasemapWriteInput;
}

@injectable()
export class BasemapsController {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(BasemapsManager) private readonly manager: BasemapsManager
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
}
