import { init as initSdk, isTMA, miniApp, retrieveRawInitData } from "@tma.js/sdk";

export interface TelegramEnv {
  isAvailable: boolean;
  initDataRaw: string | undefined;
}

/**
 * Initializes the Telegram Mini Apps SDK and returns the raw initData
 * string to send to the backend for verification. TeamFlow Sports uses its
 * own light, neutral design system rather than Telegram's theme params, so
 * no theme/CSS-var binding happens here — only lifecycle (mount/ready).
 *
 * Returns isAvailable: false when not running inside a Telegram Mini App
 * (e.g. opened directly in a regular browser during development).
 */
export function bootstrapTelegram(): TelegramEnv {
  if (!isTMA()) {
    return { isAvailable: false, initDataRaw: undefined };
  }

  try {
    initSdk();
  } catch (error) {
    console.error("Telegram SDK init failed", error);
    return { isAvailable: false, initDataRaw: undefined };
  }

  // Never let a failure here take down the whole app (e.g. blank screen)
  // before auth even runs.
  try {
    miniApp.mount.ifAvailable();
    miniApp.ready.ifAvailable();
  } catch (error) {
    console.error("Telegram mini app mount failed", error);
  }

  let initDataRaw: string | undefined;
  try {
    initDataRaw = retrieveRawInitData();
  } catch (error) {
    console.error("Failed to retrieve Telegram initData", error);
    initDataRaw = undefined;
  }

  return { isAvailable: true, initDataRaw };
}
