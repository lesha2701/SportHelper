import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { toFormError } from "./formError";

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Loads on focus (so a screen is fresh when you come back to it) and exposes loading / error / reload. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const reload = useCallback(() => {
    const id = ++run.current;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (id === run.current) setData(result);
      })
      .catch((e: unknown) => {
        if (id === run.current) setError(toFormError(e).message);
      })
      .finally(() => {
        if (id === run.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(reload);
  return { data, loading, error, reload };
}
