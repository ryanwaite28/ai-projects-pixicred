export function log(
  level: 'info' | 'warn' | 'error',
  action: string,
  durationMs: number,
  meta?: Record<string, unknown>,
): void {
  process.stdout.write(JSON.stringify({ level, action, durationMs, ...meta }) + '\n');
}
