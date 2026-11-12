import { router } from "expo-router";
import { useEffect } from "react";
import { registerForPush, watchTaps, watchTokenChanges } from "./push";
import { routeForPushData } from "@/shared/lib/pushData";

/** Push for the signed-in person: register this phone, keep the token fresh, and open the screen a tapped push is about. */
export function usePush(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void registerForPush();
    const stopToken = watchTokenChanges();
    const stopTaps = watchTaps((data) => {
      const route = routeForPushData(data);
      if (route) router.push(route);
    });
    return () => {
      stopToken();
      stopTaps();
    };
  }, [enabled]);
}
