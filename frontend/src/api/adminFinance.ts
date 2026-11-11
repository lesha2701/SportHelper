import { apiRequest } from "./client";

/** The administrators' «Финансы». Amounts are integer kopecks. The server answers in snake_case; every field is mapped to camelCase here
 * (keys only, values untouched), so the screens read like the rest of the admin panel. */

const QUIET = { silent: true } as const;

type Json = unknown;

function camelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function camelize<T>(value: Json): T {
  if (Array.isArray(value)) return value.map((v) => camelize(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, Json>)) out[camelKey(k)] = camelize(v);
    return out as T;
  }
  return value as T;
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

const get = async <T>(path: string) => camelize<T>(await apiRequest<Json>(path, QUIET));
const put = async <T>(path: string, body: unknown = {}) => camelize<T>(await apiRequest<Json>(path, { method: "PUT", body, silent: true }));
const post = async <T>(path: string, body: unknown = {}) => camelize<T>(await apiRequest<Json>(path, { method: "POST", body, silent: true }));

export interface FinancePage<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface CountAmount {
  count: number;
  amountKopecks: number;
}

export interface FinanceOverview {
  flags: { payments: boolean; trainerBalance: boolean; withdrawals: boolean; payoutConfirmation: boolean; twoPersonRule: boolean; releaseMode: string };
  commissionPercent: string;
  minWithdrawalKopecks: number;
  payments: { paymentsCount: number; gross: number; commissionTaken: number; trainerTotal: number; refunded: number; awaiting: number };
  grossReceivedKopecks: number;
  platformCommissionKopecks: number;
  owedToTrainers: { pendingKopecks: number; availableKopecks: number; reservedKopecks: number };
  paidOutKopecks: number;
  trainerDebtsKopecks: number;
  heldByProviderKopecks: number;
  earnings: Record<string, CountAmount & { sessionConfirmed: number }>;
  withdrawals: Record<string, CountAmount>;
  pendingWithdrawals: number;
  openIncidents: number;
  ledgerMismatches: number;
  providerFeesKopecks: number | null;
  bankReceiptsKopecks: number | null;
}

export const getFinanceOverview = () => get<FinanceOverview>("/api/admin/finance/overview");

export interface IntegrityReport {
  balanced: boolean;
  mismatches: { account: string; stored: number; computed: number }[];
}
export const getFinanceIntegrity = () => get<IntegrityReport>("/api/admin/finance/integrity");

export type PaymentRowStatus = "awaiting" | "paid" | "partially_refunded" | "refunded";

export interface AdminPaymentRow {
  id: string;
  bookingId: string;
  status: PaymentRowStatus;
  grossKopecks: number;
  platformFeeKopecks: number;
  trainerKopecks: number;
  commissionPercent: string;
  refundReservedKopecks: number;
  refundedKopecks: number;
  createdAt: string;
  paidAt: string | null;
  payerEmail: string;
  coachEmail: string;
  attempts: number;
  openIncidents: number;
}

export const listFinancePayments = (q: { status: string; q: string; limit: number; offset: number }) =>
  get<FinancePage<AdminPaymentRow>>(`/api/admin/finance/payments${queryString({ status: q.status, q: q.q.trim() || undefined, limit: q.limit, offset: q.offset })}`);

export interface PaymentDetail {
  payment: AdminPaymentRow & { listingTitle: string | null; startsAt: string | null; bookingStatus: string; trainingStatus: string | null };
  attempts: { id: string; providerPaymentId: string | null; status: string; cancellationReason: string | null; createdAt: string; paidAt: string | null; lastCheckedAt: string | null; checkCount: number }[];
  refunds: AdminRefund[];
  incidents: AdminIncident[];
  earning: { id: string; status: string; trainerKopecks: number; reversedKopecks: number; sessionConfirmedAt: string | null; releasedAt: string | null } | null;
  postings: { id: string; kind: string; businessKey: string; createdAt: string; reason: string | null }[];
}
export const getFinancePayment = (id: string) => get<PaymentDetail>(`/api/admin/finance/payments/${id}`);

export const refundPayment = (id: string, body: { amountKopecks: number; reason: string; attemptId?: string }) =>
  post<AdminRefund>(`/api/admin/finance/payments/${id}/refund`, { amount_kopecks: body.amountKopecks, reason: body.reason, attempt_id: body.attemptId });

export interface AdminRefund {
  id: string;
  paymentId: string;
  attemptId: string | null;
  kind: "payment" | "duplicate";
  amountKopecks: number;
  commissionRefundKopecks: number;
  trainerRefundKopecks: number;
  reason: string;
  status: "pending" | "succeeded" | "failed" | "canceled" | string;
  providerRefundId: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}
export const listFinanceRefunds = (limit: number, offset: number) => get<FinancePage<AdminRefund>>(`/api/admin/finance/refunds${queryString({ limit, offset })}`);

export interface AdminIncident {
  id: number;
  kind: string;
  paymentId: string | null;
  attemptId: string | null;
  detail: Record<string, unknown> | string | null;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}
export const listFinanceIncidents = (status: string, limit: number, offset: number) =>
  get<FinancePage<AdminIncident>>(`/api/admin/finance/incidents${queryString({ status, limit, offset })}`);
export const resolveFinanceIncident = (id: number, resolution: string) => post<{ id: number; status: string }>(`/api/admin/finance/incidents/${id}/resolve`, { resolution });

export type EarningStatus = "pending" | "held" | "available" | "reversed";

export interface AdminEarning {
  id: string;
  paymentId: string;
  bookingId: string;
  coachUserId: string;
  grossKopecks: number;
  platformFeeKopecks: number;
  trainerKopecks: number;
  commissionPercent: string;
  status: EarningStatus;
  reversedKopecks: number;
  heldReason: string | null;
  sessionConfirmedAt: string | null;
  releasedAt: string | null;
  releaseNote: string | null;
  createdAt: string;
  listingTitle: string | null;
  startsAt: string | null;
  trainingStatus: string | null;
  athleteFullName: string;
  coachFullName: string;
  coachEmail: string;
}
export const listFinanceEarnings = (q: { status: string; limit: number; offset: number }) =>
  get<FinancePage<AdminEarning>>(`/api/admin/finance/earnings${queryString({ status: q.status, limit: q.limit, offset: q.offset })}`);
export const releaseEarning = (id: string, note?: string) => post<AdminEarning>(`/api/admin/finance/earnings/${id}/release`, { note: note || null });
export const holdEarning = (id: string, reason: string) => post<{ id: string; status: string }>(`/api/admin/finance/earnings/${id}/hold`, { reason });
export const unholdEarning = (id: string, reason: string) => post<{ id: string; status: string }>(`/api/admin/finance/earnings/${id}/unhold`, { reason });

export type WithdrawalState = "requested" | "under_review" | "approved" | "processing" | "paid" | "rejected" | "canceled";

export interface AdminWithdrawal {
  id: string;
  coachUserId: string;
  amountKopecks: number;
  currency: string;
  status: WithdrawalState;
  method: "sbp" | "bank_transfer";
  detailsHint: string;
  decidedReason: string | null;
  bankReference: string | null;
  paidAmountKopecks: number | null;
  paidAt: string | null;
  transferNote: string | null;
  attention: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedBy: string | null;
  approvedBy: string | null;
  processingBy: string | null;
  paidBy: string | null;
  coachFullName?: string;
  coachEmail?: string;
}
export const listFinanceWithdrawals = (q: { status: string; limit: number; offset: number }) =>
  get<FinancePage<AdminWithdrawal>>(`/api/admin/finance/withdrawals${queryString({ status: q.status, limit: q.limit, offset: q.offset })}`);

export interface WithdrawalDetail {
  withdrawal: AdminWithdrawal;
  events: { id: number; fromStatus: string | null; toStatus: string; actorUserId: string | null; actorEmail: string | null; note: string | null; createdAt: string }[];
  trainerBalances: { trainerPending: number; trainerAvailable: number; trainerReserved: number; trainerDebt: number };
}
export const getFinanceWithdrawal = (id: string) => get<WithdrawalDetail>(`/api/admin/finance/withdrawals/${id}`);
export const getPayoutDetails = (id: string) => post<{ method: string; details: Record<string, string> }>(`/api/admin/finance/withdrawals/${id}/details`);

export const reviewWithdrawal = (id: string, note?: string) => post<AdminWithdrawal>(`/api/admin/finance/withdrawals/${id}/review`, { note: note || null });
export const approveWithdrawal = (id: string, note?: string) => post<AdminWithdrawal>(`/api/admin/finance/withdrawals/${id}/approve`, { note: note || null });
export const startWithdrawalProcessing = (id: string, note?: string) => post<AdminWithdrawal>(`/api/admin/finance/withdrawals/${id}/processing`, { note: note || null });
export const rejectWithdrawal = (id: string, reason: string, confirmNotSent: boolean) =>
  post<AdminWithdrawal>(`/api/admin/finance/withdrawals/${id}/reject`, { reason, confirm_not_sent: confirmNotSent });
export const markWithdrawalPaid = (id: string, body: { bankReference: string; paidAmountKopecks: number; paidAt?: string; transferNote?: string }) =>
  post<AdminWithdrawal>(`/api/admin/finance/withdrawals/${id}/paid`, {
    bank_reference: body.bankReference,
    paid_amount_kopecks: body.paidAmountKopecks,
    paid_at: body.paidAt || null,
    transfer_note: body.transferNote || null,
  });

/** A dispute about whether a booked session took place (docs/session-confirmation.md). */
export interface AdminDispute {
  bookingId: string;
  state: "disputed" | "resolved_released" | "resolved_refunded";
  coachMarkedAt: string | null;
  disputedAt: string;
  disputedByRole: "athlete" | "coach";
  disputeKind: "athlete_no_show" | "coach_no_show" | "not_conducted" | "other";
  disputeText: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  startsAt: string;
  durationMinutes: number;
  format: string;
  listingTitle: string | null;
  coachFullName: string | null;
  athleteFullName: string;
  paymentId: string | null;
  grossKopecks: number | null;
  paymentStatus: string | null;
  earningStatus: string | null;
  trainerKopecks: number | null;
}

export const listFinanceDisputes = (q: { openOnly: boolean; limit: number; offset: number }) =>
  get<FinancePage<AdminDispute>>(`/api/admin/finance/disputes${queryString({ open_only: String(q.openOnly), limit: q.limit, offset: q.offset })}`);
export const resolveFinanceDispute = (bookingId: string, outcome: "release" | "refund", note: string) =>
  post<{ bookingId: string; state: string; refundId: string | null }>(`/api/admin/finance/disputes/${bookingId}/resolve`, { outcome, note });

export interface CommissionChange {
  id: number;
  percent: string;
  previous: string | null;
  reason: string;
  changedByEmail: string | null;
  createdAt: string;
}

export interface Commission {
  percent: string;
  /** "admin": set in this panel; "environment": nobody has changed it yet, the server's setting applies. */
  source: "admin" | "environment";
  environmentPercent: string;
  maxPercent: string;
  history: CommissionChange[];
}

export const getCommission = () => get<Commission>("/api/admin/finance/commission");
export const setCommission = (percent: string, reason: string) => put<Commission>("/api/admin/finance/commission", { percent, reason });

export interface BankBalanceEntry {
  id: number;
  balanceKopecks: number;
  /** The trainers' money by the books at the moment of the entry: exact. */
  trainersKopecks: number;
  /** The rest of the account: the platform's own money (negative when the account holds less than the trainers are owed). */
  oursKopecks: number;
  note: string | null;
  enteredByEmail: string | null;
  createdAt: string;
}

export interface BankBalance {
  latest: BankBalanceEntry | null;
  /** What the trainers are owed by the books right now. */
  trainersNowKopecks: number;
  history: BankBalanceEntry[];
}

export const getBankBalance = () => get<BankBalance>("/api/admin/finance/bank-balance");
export const enterBankBalance = (balanceKopecks: number, note?: string) =>
  post<BankBalance>("/api/admin/finance/bank-balance", { balance_kopecks: balanceKopecks, note: note || null });
