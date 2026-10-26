import { StatusCodes } from 'http-status-codes';
import type { HttpError } from '@map-colonies/error-express-handler';

/** Base class for domain errors that carry an HTTP status code understood by `getErrorHandlerMiddleware`. */
export class AppHttpError extends Error implements HttpError {
  public readonly statusCode: StatusCodes;

  public constructor(statusCode: StatusCodes, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = new.target.name;
  }
}

export class ValidationError extends AppHttpError {
  public constructor(message: string) {
    super(StatusCodes.BAD_REQUEST, message);
  }
}

export class NotFoundError extends AppHttpError {
  public constructor(message: string) {
    super(StatusCodes.NOT_FOUND, message);
  }
}

/** A downstream dependency (config-server, blob storage, Raster Catalog) returned an error or is unreachable. */
export class UpstreamServiceError extends AppHttpError {
  public constructor(message: string) {
    super(StatusCodes.BAD_GATEWAY, message);
  }
}
