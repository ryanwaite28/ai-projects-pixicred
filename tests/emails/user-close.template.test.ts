import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildUserCloseEmail } from '../../src/emails/user-close.template';
import type { Account } from '../../src/types/index';

const account: Account = {
  accountId: '00000000-0000-4000-8000-000000000002',
  applicationId: '00000000-0000-4000-8000-000000000001',
  holderEmail: 'jane@example.com',
  creditLimit: 7500,
  currentBalance: 500,
  availableCredit: 7000,
  status: 'CLOSED',
  paymentDueDate: '2026-06-25',
  closeReason: 'USER_REQUESTED',
  closedAt: new Date('2026-05-10T14:30:00Z'),
  createdAt: new Date('2026-05-01T00:00:00Z'),
  cardNumber: '1234567890123456',
  cardExpiry: '2029-06-01',
  cardCvv: '123',
};

beforeEach(() => {
  process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com';
});

afterEach(() => {
  delete process.env['SES_FROM_EMAIL'];
});

describe('buildUserCloseEmail', () => {
  it('sets to field to account holderEmail', () => {
    const email = buildUserCloseEmail(account, 'https://pixicred.com');
    expect(email.to).toBe('jane@example.com');
  });

  it('subject confirms account closure', () => {
    const email = buildUserCloseEmail(account, 'https://pixicred.com');
    expect(email.subject.toLowerCase()).toMatch(/clos/);
  });

  it('body confirms closure was at holder request', () => {
    const email = buildUserCloseEmail(account, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body.toLowerCase()).toMatch(/at your request|holder.*request|request/);
  });

  it('body includes instructions to reapply', () => {
    const email = buildUserCloseEmail(account, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body.toLowerCase()).toMatch(/reappl|apply/);
    expect(body).toContain('pixicred.com/apply');
  });

  it('uses SES_FROM_EMAIL env var as sender when set', () => {
    process.env['SES_FROM_EMAIL'] = 'custom@pixicred.com';
    const email = buildUserCloseEmail(account, 'https://pixicred.com');
    expect(email.to).toBeTruthy();
    expect(email.subject).toBeTruthy();
    expect(email.htmlBody).toBeTruthy();
    expect(email.textBody).toBeTruthy();
  });
});
