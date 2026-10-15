import { Router } from 'express';
import type { FactoryFunction } from 'tsyringe';
import { BasemapsController } from '../controllers/basemapsController';
import { BasemapImportExportController } from '../controllers/basemapImportExportController';

const basemapsRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const basemapsController = dependencyContainer.resolve(BasemapsController);
  const importExportController = dependencyContainer.resolve(BasemapImportExportController);

  router.get('/', basemapsController.listBasemaps);
  router.post('/', basemapsController.createBasemap);
  router.post('/thumbnails', basemapsController.uploadBasemapThumbnail);
  router.post('/import/validate', importExportController.validateBasemapImport);
  router.get('/:basemapId', basemapsController.getBasemap);
  router.put('/:basemapId', basemapsController.updateBasemap);
  router.delete('/:basemapId', basemapsController.deleteBasemap);
  router.get('/:basemapId/export', importExportController.exportBasemap);

  return router;
};

export const BASEMAPS_ROUTER_SYMBOL = Symbol('BasemapsRouterFactory');

export { basemapsRouterFactory };
