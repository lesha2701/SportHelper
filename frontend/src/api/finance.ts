import { apiRequest } from "./client";
import {
  mapFinanceSummaryDto,
  mapOperationDto,
  mapWithdrawalDto,
  type FinanceOperation,
  type FinanceOperationDto,
  type FinanceSummary,
  type FinanceSummaryDto,
  type Page,
  type Withdrawal,
  type WithdrawalDto,
  type WithdrawalForm,
} from "../types/finance";

interface PageDto<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

function mapPage<D, T>(dto: PageDto<D>, map: (item: D) => T): Page<T> {
  return { total: dto.total, limit: dto.limit, offset: dto.offset, items: dto.items.map(map) };
}

export async function getFinanceSummary(token: string): Promise<FinanceSummary> {
  return mapFinanceSummaryDto(await apiRequest<FinanceSummaryDto>("/api/finance/summary", { token, silent: true }));
}

export async function listFinanceOperations(token: string, limit: number, offset: number): Promise<Page<FinanceOperation>> {
  const dto = await apiRequest<PageDto<FinanceOperationDto>>(`/api/finance/operations?limit=${limit}&offset=${offset}`, { token, silent: true });
  return mapPage(dto, mapOperationDto);
}

export async function listMyWithdrawals(token: string, limit: number, offset: number): Promise<Page<Withdrawal>> {
  const dto = await apiRequest<PageDto<WithdrawalDto>>(`/api/finance/withdrawals?limit=${limit}&offset=${offset}`, { token, silent: true });
  return mapPage(dto, mapWithdrawalDto);
}

/** `clientKey` is generated once per opened form: pressing the button twice (or retrying) can only ever create one request. */
export async function requestWithdrawal(token: string, form: WithdrawalForm): Promise<Withdrawal> {
  const dto = await apiRequest<WithdrawalDto>("/api/finance/withdrawals", {
    method: "POST",
    token,
    silent: true,
    body: { amount_kopecks: form.amountKopecks, method: form.method, details: form.details, client_key: form.clientKey, password: form.password },
  });
  return mapWithdrawalDto(dto);
}

export async function cancelWithdrawal(token: string, id: string): Promise<Withdrawal> {
  return mapWithdrawalDto(await apiRequest<WithdrawalDto>(`/api/finance/withdrawals/${id}/cancel`, { method: "POST", token, silent: true }));
}
