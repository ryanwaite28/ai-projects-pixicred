export function generateCardNumber(): string {
  const n = Math.floor(Math.random() * 1e16);
  return String(n).padStart(16, '0');
}

export function generateCardExpiry(from: Date): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 36);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function generateCardCvv(): string {
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}
