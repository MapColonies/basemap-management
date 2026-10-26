import type { IPersistedBasemap } from './types';

export interface IDefaultRoleUpdate {
  isCurrent?: boolean;
  isForPreview?: boolean;
}

export const findCurrentOwner = (basemaps: readonly IPersistedBasemap[]): IPersistedBasemap | undefined =>
  basemaps.find((basemap) => basemap.isCurrent);

export const findPreviewOwner = (basemaps: readonly IPersistedBasemap[]): IPersistedBasemap | undefined =>
  basemaps.find((basemap) => basemap.isForPreview);

export function applyDefaultRoles(basemaps: readonly IPersistedBasemap[], targetId: string, update: IDefaultRoleUpdate): IPersistedBasemap[] {
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

export function assertSingleOwnerPerRole(basemaps: readonly IPersistedBasemap[]): void {
  const currentOwnerIds = basemaps.filter((basemap) => basemap.isCurrent).map((basemap) => basemap.id);
  const previewOwnerIds = basemaps.filter((basemap) => basemap.isForPreview).map((basemap) => basemap.id);

  const maxOwners = 1;
  if (currentOwnerIds.length > maxOwners) {
    throw new Error(`invariant violated: multiple basemaps have isCurrent=true: ${currentOwnerIds.join(', ')}`);
  }
  if (previewOwnerIds.length > maxOwners) {
    throw new Error(`invariant violated: multiple basemaps have isForPreview=true: ${previewOwnerIds.join(', ')}`);
  }
}
