export type ApplicationStatus = 'PENDING' | 'APPROVED' | 'DECLINED';
export type AccountStatus     = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type TransactionType   = 'CHARGE' | 'PAYMENT';
export type CloseReason       = 'USER_REQUESTED' | 'AUTO_NONPAYMENT';

export interface Application {
  applicationId:  string;
  email:          string;
  firstName:      string;
  lastName:       string;
  dateOfBirth:    string;   // ISO date YYYY-MM-DD
  annualIncome:   number;
  mockSsn:        string;
  status:         ApplicationStatus;
  creditLimit:    number | null;
  createdAt:      Date;
  decidedAt:      Date | null;
}

export interface Account {
  accountId:       string;
  applicationId:   string;
  holderEmail:     string;
  creditLimit:     number;
  currentBalance:  number;
  availableCredit: number;  // derived: creditLimit - currentBalance; never persisted
  status:          AccountStatus;
  paymentDueDate:  string;  // ISO date YYYY-MM-DD
  closeReason:     CloseReason | null;
  closedAt:        Date | null;
  createdAt:       Date;
}

export interface PaymentDueSchedule {
  accountId:        string;
  paymentDueDate:   string;  // ISO date YYYY-MM-DD
  satisfied:        boolean;
  satisfiedAt:      Date | null;
  reminderSentDate: string | null;  // ISO date YYYY-MM-DD
  createdAt:        Date;
}

export interface Transaction {
  transactionId:  string;
  accountId:      string;
  type:           TransactionType;
  merchantName:   string | null;
  amount:         number;
  idempotencyKey: string;
  createdAt:      Date;
}

export interface Statement {
  statementId:       string;
  accountId:         string;
  periodStart:       Date;
  periodEnd:         Date;
  openingBalance:    number;
  closingBalance:    number;
  totalCharges:      number;
  totalPayments:     number;
  minimumPaymentDue: number;
  dueDate:           string;  // ISO date YYYY-MM-DD
  generatedAt:       Date;
  transactions:      Transaction[];  // populated on detail fetch only
}

export interface NotificationPreference {
  accountId:               string;
  transactionsEnabled:     boolean;
  statementsEnabled:       boolean;
  paymentRemindersEnabled: boolean;
  updatedAt:               Date;
}
