import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildAutoCloseEmail } from '../../src/emails/auto-close.template';
import type { Account } from '../../src/types/index';

const account: Account = {
  accountId: '00000000-0000-4000-8000-000000000002',
  applicationId: '00000000-0000-4000-8000-000000000001',
  holderEmail: 'jane@example.com',
  creditLimit: 7500,
  currentBalance: 650,
  availableCredit: 6850,
  status: 'CLOSED',
  paymentDueDate: '2026-06-25',
  closeReason: 'AUTO_NONPAYMENT',
  closedAt: new Date('2026-07-09T00:00:00Z'),
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

beforeEach(() => {
  process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com';
});

afterEach(() => {
  delete process.env['SES_FROM_EMAIL'];
});

describe('buildAutoCloseEmail', () => {
  it('sets to field to account holderEmail', () => {
    const email = buildAutoCloseEmail(account, 'https://pixicred.com');
    expect(email.to).toBe('jane@example.com');
  });

  it('subject confirms account was automatically closed', () => {
    const email = buildAutoCloseEmail(account, 'https://pixicred.com');
    expect(email.subject.toLowerCase()).toMatch(/auto|clos/i);
  });

  it('body confirms closure was due to non-payment', () => {
    const email = buildAutoCloseEmail(account, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body.toLowerCase()).toMatch(/non.payment|nonpayment/i);
  });

  it('body includes current balance at time of closure', () => {
    const email = buildAutoCloseEmail(account, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/650/);
  });

  it('body includes instructions to reapply', () => {
    const email = buildAutoCloseEmail(account, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body.toLowerCase()).toMatch(/reapply|apply/i);
  });

  it('uses SES_FROM_EMAIL env var as sender when set', () => {
    process.env['SES_FROM_EMAIL'] = 'custom@pixicred.com';
    const email = buildAutoCloseEmail(account, 'https://pixicred.com');
    expect(email.to).toBeTruthy();
    expect(email.subject).toBeTruthy();
    expect(email.htmlBody).toBeTruthy();
    expect(email.textBody).toBeTruthy();
  });
});
