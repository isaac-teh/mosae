import { useCallback } from "react";
import { type Href, useRouter } from "expo-router";

/** Back to the previous flow step. A scene opened from a link has no history, so fall back to that step's route. */
export function useStepBack(previous: Href) {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(previous);
  }, [router, previous]);
}
