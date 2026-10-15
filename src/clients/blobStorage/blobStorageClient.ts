export interface IUploadBlobParams {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface IBlobStorageClient {
  upload: (params: IUploadBlobParams) => Promise<{ url: string }>;
}

export const BLOB_STORAGE_CLIENT = Symbol('BlobStorageClient');
