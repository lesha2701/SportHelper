/** The trainer's finance screen. Every amount is integer kopecks; the browser never computes a balance, a price or a commission. */

export interface FinanceSummary {
  availableKopecks: number;
  pendingKopecks: number;
  reservedKopecks: number;
  paidOutKopecks: number;
  debtKopecks: number;
  minimumWithdrawalKopecks: number;
  withdrawalsEnabled: boolean;
  canWithdraw: boolean;
  shortfallKopecks: number;
  commissionPercent: string;
}

export interface FinanceSummaryDto {
  available_kopecks: number;
  pending_kopecks: number;
  reserved_kopecks: number;
  paid_out_kopecks: number;
  debt_kopecks: number;
  minimum_withdrawal_kopecks: number;
  withdrawals_enabled: boolean;
  can_withdraw: boolean;
  shortfall_kopecks: number;
  commission_percent: string;
}

export function mapFinanceSummaryDto(dto: FinanceSummaryDto): FinanceSummary {
  return {
    availableKopecks: dto.available_kopecks,
    pendingKopecks: dto.pending_kopecks,
    reservedKopecks: dto.reserved_kopecks,
    paidOutKopecks: dto.paid_out_kopecks,
    debtKopecks: dto.debt_kopecks,
    minimumWithdrawalKopecks: dto.minimum_withdrawal_kopecks,
    withdrawalsEnabled: dto.withdrawals_enabled,
    canWithdraw: dto.can_withdraw,
    shortfallKopecks: dto.shortfall_kopecks,
    commissionPercent: dto.commission_percent,
  };
}

export type WithdrawalStatus = "requested" | "under_review" | "approved" | "processing" | "paid" | "rejected" | "canceled";

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  requested: "Заявка создана",
  under_review: "На проверке",
  approved: "Одобрена",
  processing: "Передана на выплату",
  paid: "Выплачено",
  rejected: "Отклонена",
  canceled: "Отменена",
};

/** The trainer may take the request back only until it has gone to payment. */
export const CANCELABLE_WITHDRAWAL_STATUSES: WithdrawalStatus[] = ["requested", "under_review", "approved"];

export interface Withdrawal {
  id: string;
  amountKopecks: number;
  status: WithdrawalStatus;
  method: PayoutMethod;
  detailsHint: string;
  decidedReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface WithdrawalDto {
  id: string;
  amount_kopecks: number;
  status: WithdrawalStatus;
  method: PayoutMethod;
  details_hint: string;
  decided_reason: string | null;
  paid_at: string | null;
  created_at: string;
}

export function mapWithdrawalDto(dto: WithdrawalDto): Withdrawal {
  return {
    id: dto.id,
    amountKopecks: dto.amount_kopecks,
    status: dto.status,
    method: dto.method,
    detailsHint: dto.details_hint,
    decidedReason: dto.decided_reason,
    paidAt: dto.paid_at,
    createdAt: dto.created_at,
  };
}

export type PayoutMethod = "sbp" | "bank_transfer";

export const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = { sbp: "СБП по номеру телефона", bank_transfer: "Банковский перевод по реквизитам" };

export type OperationKind = "payment_received" | "earning_released" | "withdrawal_reserved" | "withdrawal_released" | "withdrawal_paid" | "refund" | string;

export interface FinanceOperation {
  id: string;
  kind: OperationKind;
  createdAt: string;
  amountKopecks: number;
  grossKopecks: number | null;
  platformFeeKopecks: number | null;
  trainerKopecks: number | null;
  listingTitle: string | null;
  startsAt: string | null;
  earningStatus: string | null;
  withdrawalStatus: WithdrawalStatus | null;
  refundStatus: string | null;
}

export interface FinanceOperationDto {
  id: string;
  kind: string;
  created_at: string;
  amount_kopecks: number;
  gross_kopecks: number | null;
  platform_fee_kopecks: number | null;
  trainer_kopecks: number | null;
  listing_title: string | null;
  starts_at: string | null;
  earning_status: string | null;
  withdrawal_status: WithdrawalStatus | null;
  refund_status: string | null;
}

export function mapOperationDto(dto: FinanceOperationDto): FinanceOperation {
  return {
    id: dto.id,
    kind: dto.kind,
    createdAt: dto.created_at,
    amountKopecks: dto.amount_kopecks,
    grossKopecks: dto.gross_kopecks,
    platformFeeKopecks: dto.platform_fee_kopecks,
    trainerKopecks: dto.trainer_kopecks,
    listingTitle: dto.listing_title,
    startsAt: dto.starts_at,
    earningStatus: dto.earning_status,
    withdrawalStatus: dto.withdrawal_status,
    refundStatus: dto.refund_status,
  };
}

export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface WithdrawalForm {
  amountKopecks: number;
  method: PayoutMethod;
  details: Record<string, string>;
  clientKey: string;
  password: string;
}
