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

// ─── Infrastructure client interfaces ────────────────────────────────────────

export interface SesClient {
  sendEmail(input: { to: string; subject: string; htmlBody: string; textBody: string }): Promise<void>;
}

export interface SnsClient {
  publishEvent(topicArn: string, eventType: string, payload: unknown): Promise<void>;
}

export interface SqsClient {
  sendMessage(queueUrl: string, body: unknown): Promise<void>;
}

export interface ServiceClients {
  sesClient: SesClient;
  snsClient: SnsClient;
  sqsClient: SqsClient;
}

// ─── Service action payload types ────────────────────────────────────────────

export interface SubmitApplicationInput {
  email:        string;
  firstName:    string;
  lastName:     string;
  dateOfBirth:  string;
  annualIncome: number;
  mockSsn:      string;
}

export interface PostChargeInput {
  accountId:     string;
  merchantName?: string;
  amount:        number;
  idempotencyKey: string;
}

export interface PostPaymentInput {
  accountId:      string;
  amount:         number | 'FULL';
  idempotencyKey: string;
}

export interface GetTransactionsInput {
  accountId: string;
  cursor?:   string;
  limit?:    number;
}

export interface UpdateNotificationPrefsInput {
  accountId:               string;
  transactionsEnabled?:    boolean;
  statementsEnabled?:      boolean;
  paymentRemindersEnabled?: boolean;
}

// ─── ServiceAction discriminated union ───────────────────────────────────────

export type ServiceAction =
  | { action: 'submitApplication';             payload: SubmitApplicationInput }
  | { action: 'getApplication';                payload: { applicationId: string } }
  | { action: 'runCreditCheck';                payload: { applicationId: string } }
  | { action: 'getAccount';                    payload: { accountId: string } }
  | { action: 'closeAccount';                  payload: { accountId: string; reason: CloseReason } }
  | { action: 'postCharge';                    payload: PostChargeInput }
  | { action: 'postPayment';                   payload: PostPaymentInput }
  | { action: 'getTransactions';               payload: GetTransactionsInput }
  | { action: 'generateStatement';             payload: { accountId: string } }
  | { action: 'generateAllStatements';         payload: { period: 'weekly' | 'monthly' } }
  | { action: 'getStatements';                 payload: { accountId: string } }
  | { action: 'getStatement';                  payload: { accountId: string; statementId: string } }
  | { action: 'getNotificationPreferences';    payload: { accountId: string } }
  | { action: 'updateNotificationPreferences'; payload: UpdateNotificationPrefsInput }
  | { action: 'sendDeclineEmail';              payload: { applicationId: string } }
  | { action: 'sendApprovalEmail';             payload: { applicationId: string } }
  | { action: 'sendTransactionEmail';          payload: { transactionId: string } }
  | { action: 'sendStatementEmail';            payload: { statementId: string } }
  | { action: 'sendPaymentDueReminderEmail';   payload: { accountId: string } }
  | { action: 'sendAutoCloseEmail';            payload: { accountId: string } }
  | { action: 'sendUserCloseEmail';            payload: { accountId: string } }
  | { action: 'runBillingLifecycle';           payload: { lookaheadDays: number } }
  | { action: 'registerPortalAccount';         payload: { email: string; accountId: string; password: string } }
  | { action: 'loginPortalAccount';            payload: { email: string; password: string } };
