import { StatusCodes } from 'http-status-codes';
import type { HttpError } from '@map-colonies/error-express-handler';

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

export class UpstreamServiceError extends AppHttpError {
  public constructor(message: string) {
    super(StatusCodes.BAD_GATEWAY, message);
  }
}

export class CorruptPersistedDataError extends AppHttpError {
  public constructor(message: string) {
    super(StatusCodes.INTERNAL_SERVER_ERROR, message);
  }
}
