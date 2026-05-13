import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildStatementEmail } from '../../src/emails/statement.template';
import type { Statement, Account } from '../../src/types/index';

const account: Account = {
  accountId: '00000000-0000-4000-8000-000000000002',
  applicationId: '00000000-0000-4000-8000-000000000001',
  holderEmail: 'jane@example.com',
  creditLimit: 7500,
  currentBalance: 650,
  availableCredit: 6850,
  status: 'ACTIVE',
  paymentDueDate: '2026-06-25',
  closeReason: null,
  closedAt: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const statement: Statement = {
  statementId: '00000000-0000-4000-8000-000000000010',
  accountId: account.accountId,
  periodStart: new Date('2026-05-01T00:00:00Z'),
  periodEnd: new Date('2026-06-01T00:00:00Z'),
  openingBalance: 500,
  closingBalance: 650,
  totalCharges: 250,
  totalPayments: 100,
  minimumPaymentDue: 25,
  dueDate: '2026-06-22',
  generatedAt: new Date('2026-06-01T00:05:00Z'),
  transactions: [],
};

beforeEach(() => {
  process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com';
});

afterEach(() => {
  delete process.env['SES_FROM_EMAIL'];
});

describe('buildStatementEmail', () => {
  it('sets to field to account holderEmail', () => {
    const email = buildStatementEmail(statement, account);
    expect(email.to).toBe('jane@example.com');
  });

  it('subject references statement period', () => {
    const email = buildStatementEmail(statement, account);
    expect(email.subject).toContain('2026-05-01');
    expect(email.subject).toContain('2026-06-01');
  });

  it('body includes closing balance', () => {
    const email = buildStatementEmail(statement, account);
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/650/);
  });

  it('body includes minimum payment due', () => {
    const email = buildStatementEmail(statement, account);
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/25/);
  });

  it('body includes due date', () => {
    const email = buildStatementEmail(statement, account);
    const body = email.htmlBody + email.textBody;
    expect(body).toContain('2026-06-22');
  });

  it('uses SES_FROM_EMAIL env var as sender when set', () => {
    process.env['SES_FROM_EMAIL'] = 'custom@pixicred.com';
    const email = buildStatementEmail(statement, account);
    expect(email.to).toBeTruthy();
    expect(email.subject).toBeTruthy();
    expect(email.htmlBody).toBeTruthy();
    expect(email.textBody).toBeTruthy();
  });
});
