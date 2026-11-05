import { apiRequest } from "./client";

export interface Features {
  telegram: boolean;
  /** Online payment is configured on the server. */
  payments: boolean;
  /** The trainer's «Финансы» section is switched on. */
  trainerBalance: boolean;
  /** Trainers may ask for withdrawals. */
  trainerWithdrawals: boolean;
}

let loaded: Promise<Features> | null = null;

/** What the server offers (from its .env). Asked once per page load; on any failure everything optional stays off. */
export function getFeatures(): Promise<Features> {
  loaded ??= apiRequest<{ telegram?: boolean; payments?: boolean; trainer_balance?: boolean; trainer_withdrawals?: boolean }>("/api/features", { silent: true })
    .then((dto) => ({
      telegram: dto.telegram === true,
      payments: dto.payments === true,
      trainerBalance: dto.trainer_balance === true,
      trainerWithdrawals: dto.trainer_withdrawals === true,
    }))
    .catch(() => ({ telegram: false, payments: false, trainerBalance: false, trainerWithdrawals: false }));
  return loaded;
}

/** Forgets the answer (tests only). */
export function resetFeaturesCache(): void {
  loaded = null;
}
