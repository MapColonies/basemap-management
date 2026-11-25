import type { PersistedBasemap } from './types';

export interface IDefaultRoleUpdate {
  isCurrent?: boolean;
  isForPreview?: boolean;
}

export const findCurrentOwner = (basemaps: readonly PersistedBasemap[]): PersistedBasemap | undefined =>
  basemaps.find((basemap) => basemap.isCurrent);

export const findPreviewOwner = (basemaps: readonly PersistedBasemap[]): PersistedBasemap | undefined =>
  basemaps.find((basemap) => basemap.isForPreview);

export function applyDefaultRoles(basemaps: readonly PersistedBasemap[], targetId: string, update: IDefaultRoleUpdate): PersistedBasemap[] {
  return basemaps.map((basemap) => {
    if (basemap.id === targetId) {
      return {
        ...basemap,
        isCurrent: update.isCurrent ?? basemap.isCurrent,
        isForPreview: update.isForPreview ?? basemap.isForPreview,
      };
    }

    return {
      ...basemap,
      isCurrent: update.isCurrent === true ? false : basemap.isCurrent,
      isForPreview: update.isForPreview === true ? false : basemap.isForPreview,
    };
  });
}
