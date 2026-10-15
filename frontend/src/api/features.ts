import { apiRequest } from "./client";

export interface Features {
  telegram: boolean;
}

let loaded: Promise<Features> | null = null;

/** What the server offers (from its .env). Asked once per page load; on any failure everything optional stays off. */
export function getFeatures(): Promise<Features> {
  loaded ??= apiRequest<{ telegram?: boolean }>("/api/features", { silent: true })
    .then((dto) => ({ telegram: dto.telegram === true }))
    .catch(() => ({ telegram: false }));
  return loaded;
}

/** Forgets the answer (tests only). */
export function resetFeaturesCache(): void {
  loaded = null;
}
