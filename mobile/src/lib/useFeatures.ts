import { useEffect, useState } from "react";
import { getFeatures, type Features } from "@/api/features";

const OFF: Features = { telegram: false, payments: false, trainerBalance: false, trainerWithdrawals: false };

/** What the server has switched on; everything optional is off until it answers. */
export function useFeatures(): Features {
  const [features, setFeatures] = useState<Features>(OFF);
  useEffect(() => {
    let alive = true;
    void getFeatures().then((f) => alive && setFeatures(f));
    return () => {
      alive = false;
    };
  }, []);
  return features;
}
