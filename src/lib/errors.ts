export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_APPLICATION'
  | 'APPLICATION_NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'PAYMENT_EXCEEDS_BALANCE'
  | 'STATEMENT_NOT_FOUND'
  | 'ACCOUNT_ALREADY_CLOSED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_CREDENTIALS'
  | 'PORTAL_ACCOUNT_EXISTS'
  | 'PORTAL_ACCOUNT_NOT_ELIGIBLE'
  | 'ACCOUNT_CLOSED'
  | 'CARD_NOT_FOUND'
  | 'INVALID_CARD_CVV'
  | 'CARD_EXPIRED'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_NOT_DISPUTABLE'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export class PixiCredError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PixiCredError';
  }
}

export function toHttpStatus(code: ErrorCode): number {
  switch (code) {
    case 'VALIDATION_ERROR':            return 400;
    case 'DUPLICATE_APPLICATION':       return 409;
    case 'APPLICATION_NOT_FOUND':       return 404;
    case 'ACCOUNT_NOT_FOUND':           return 404;
    case 'ACCOUNT_NOT_ACTIVE':          return 422;
    case 'PAYMENT_EXCEEDS_BALANCE':     return 422;
    case 'STATEMENT_NOT_FOUND':         return 404;
    case 'ACCOUNT_ALREADY_CLOSED':      return 422;
    case 'ACCOUNT_CLOSED':              return 422;
    case 'CARD_NOT_FOUND':              return 404;
    case 'INVALID_CARD_CVV':            return 422;
    case 'CARD_EXPIRED':                return 422;
    case 'TRANSACTION_NOT_FOUND':       return 404;
    case 'TRANSACTION_NOT_DISPUTABLE':  return 422;
    case 'UNAUTHORIZED':                return 401;
    case 'FORBIDDEN':                   return 403;
    case 'INVALID_CREDENTIALS':         return 401;
    case 'PORTAL_ACCOUNT_EXISTS':       return 409;
    case 'PORTAL_ACCOUNT_NOT_ELIGIBLE': return 422;
    case 'NOT_IMPLEMENTED':             return 501;
    case 'INTERNAL_ERROR':              return 500;
  }
}
