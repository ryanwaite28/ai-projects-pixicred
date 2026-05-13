import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApprovalEmail } from '../../src/emails/approval.template';
import type { Application, Account } from '../../src/types/index';

const app: Application = {
  applicationId: '00000000-0000-4000-8000-000000000001',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '1990-06-15',
  annualIncome: 75000,
  mockSsn: '12345',
  status: 'APPROVED',
  creditLimit: 7500,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  decidedAt: new Date('2026-05-01T00:01:00Z'),
};

const account: Account = {
  accountId: '00000000-0000-4000-8000-000000000002',
  applicationId: app.applicationId,
  holderEmail: app.email,
  creditLimit: 7500,
  currentBalance: 500,
  availableCredit: 7000,
  status: 'ACTIVE',
  paymentDueDate: '2026-06-25',
  closeReason: null,
  closedAt: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

beforeEach(() => {
  process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com';
});

afterEach(() => {
  delete process.env['SES_FROM_EMAIL'];
});

describe('buildApprovalEmail', () => {
  it('sets to field to applicant email', () => {
    const email = buildApprovalEmail(app, account);
    expect(email.to).toBe('jane@example.com');
  });

  it('subject indicates approval', () => {
    const email = buildApprovalEmail(app, account);
    const subjectLower = email.subject.toLowerCase();
    expect(subjectLower).toMatch(/approv/);
  });

  it('body includes credit limit', () => {
    const email = buildApprovalEmail(app, account);
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/7[,.]?500/);
  });

  it('body labels accountId as Account Setup Code', () => {
    const email = buildApprovalEmail(app, account);
    const body = email.htmlBody + email.textBody;
    expect(body.toLowerCase()).toContain('account setup code');
    expect(body).toContain(account.accountId);
  });

  it('body includes link or reference to pixicred.com/setup', () => {
    const email = buildApprovalEmail(app, account);
    const body = email.htmlBody + email.textBody;
    expect(body).toContain('pixicred.com/setup');
  });

  it('body includes opening balance of 500', () => {
    const email = buildApprovalEmail(app, account);
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/500/);
  });

  it('body includes payment due date from account.paymentDueDate', () => {
    const email = buildApprovalEmail(app, account);
    const body = email.htmlBody + email.textBody;
    expect(body).toContain('2026-06-25');
  });

  it('uses SES_FROM_EMAIL env var as sender when set', () => {
    process.env['SES_FROM_EMAIL'] = 'custom@pixicred.com';
    const email = buildApprovalEmail(app, account);
    expect(email.to).toBeTruthy();
    expect(email.subject).toBeTruthy();
    expect(email.htmlBody).toBeTruthy();
    expect(email.textBody).toBeTruthy();
  });
});
