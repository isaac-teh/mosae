import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type StoryPlan, type StoryRepository } from "@mosae/core";

export function useStoryPlan(planId: string, repository: StoryRepository) {
  const identity = useMemo(() => ({ planId, repository }), [planId, repository]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const empty = { plan: null as StoryPlan | null, error: null as string | null, mutationError: null as string | null, updating: false };
  const [state, setState] = useState({ identity, ...empty });
  // After an edit the screen points its URL at the version it already shows;
  // that is the same plan, so keep it rather than blanking and reloading.
  const adopted = state.identity !== identity && state.identity.repository === repository && state.plan?.planId === planId;
  const visible = state.identity === identity || adopted ? state : empty;
  const request = useRef(0);
  const busy = useRef<typeof identity | null>(null);
  const load = useCallback(async () => {
    const operation = ++request.current;
    const current = () => currentIdentity.current === identity && request.current === operation;
    setState({ identity, plan: null, error: null, mutationError: null, updating: false });
    busy.current = null;
    try {
      const plan = await repository.getPlan(planId);
      if (current()) setState(value => ({ ...value, plan }));
    } catch (cause) {
      if (current()) setState(value => ({ ...value, error: cause instanceof Error ? cause.message : "Could not load your story." }));
    }
  }, [identity, repository, planId]);
  useEffect(() => {
    if (adopted) { setState((value) => ({ ...value, identity })); return; }
    void load();
    return () => { request.current++; };
  }, [load]);
  const mutate = async (write: (id: string) => Promise<StoryPlan>) => {
    if (!visible.plan || busy.current === identity) return false;
    busy.current = identity;
    const operation = ++request.current;
    const current = () => currentIdentity.current === identity && request.current === operation;
    setState(value => ({ ...value, updating: true, mutationError: null }));
    try {
      const plan = await write(visible.plan.planId);
      if (!current()) return false;
      setState(value => ({ ...value, plan }));
      return true;
    } catch (e) {
      if (current()) setState(value => ({ ...value, mutationError: e instanceof Error ? e.message : "Could not update your moments. Try again." }));
      return false;
    } finally {
      if (current()) {
        busy.current = null;
        setState(value => ({ ...value, updating: false }));
      }
    }
  };
  return { ...visible, mutate, load };
}
