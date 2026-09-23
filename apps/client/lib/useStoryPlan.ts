import { useEffect, useRef, useState } from "react";
import { getStoryRepository, type StoryPlan } from "@mosae/core";

export function useStoryPlan(planId: string) {
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const busy = useRef(false);
  const load = () => {
    setError(null);
    return getStoryRepository().getPlan(planId).then(setPlan).catch((e) => setError(e.message));
  };
  useEffect(() => { void load(); }, [planId]);
  const mutate = async (write: (id: string) => Promise<StoryPlan>) => {
    if (!plan || busy.current) return false;
    busy.current = true;
    setUpdating(true);
    setMutationError(null);
    try {
      setPlan(await write(plan.planId));
      return true;
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "Could not update your moments. Try again.");
      return false;
    } finally {
      busy.current = false;
      setUpdating(false);
    }
  };
  return { plan, error, mutationError, updating, mutate, load };
}
