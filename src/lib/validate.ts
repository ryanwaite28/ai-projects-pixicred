import { PixiCredError } from './errors.js';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string): void {
  if (!UUID_V4_RE.test(value)) {
    throw new PixiCredError('VALIDATION_ERROR', `${field} must be a valid UUID v4`);
  }
}
