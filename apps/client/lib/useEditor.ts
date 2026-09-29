import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Asset } from "expo-asset";
import { applyEdits, mergeOps, type EditOp, type Timeline } from "@mosae/contracts";
import { getStoryRepository, type EditorMediaItem, type StoryRepository } from "@mosae/core";
import { demoImage } from "./demoAssets";

type SaveState = { state: "saved" | "saving" | "retrying" | "conflict" | "rendering" | "ready" };
type History = { snapshots: EditOp[][]; index: number };

const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const keyOf = (ops: EditOp[]) => JSON.stringify(ops);
const sourceUri = (value: string) => value.startsWith("demo:") ? Asset.fromModule(demoImage(value.slice(5))).uri : value;

export function useEditor(projectId: string, generationId: string, repository: StoryRepository = getStoryRepository()) {
  const [firstCut, setFirstCut] = useState<Timeline | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [unusedMedia, setUnusedMedia] = useState<EditorMediaItem[]>([]);
  const [history, setHistory] = useState<History>({ snapshots: [[]], index: 0 });
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ state: "saved" });
  const [savedOpsKey, setSavedOpsKey] = useState("[]");
  const [savedRevision, setSavedRevision] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [renderRequest, setRenderRequest] = useState<{ revision: number; requestId: number } | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const renderRequestId = useRef(0);
  const revisionRef = useRef(0);
  const savedOpsKeyRef = useRef("[]");
  const ops = history.snapshots[history.index] ?? [];
  const opsRef = useRef(ops);
  opsRef.current = ops;
  const opsKey = keyOf(ops);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError(null);
    void Promise.all([repository.getFilmTimeline(projectId, generationId), repository.getEdits(projectId, generationId)])
      .then(([film, edits]) => {
        if (!active) return;
        setFirstCut(film.timeline);
        setSources(Object.fromEntries([
          ...Object.entries(film.sources),
          ...(film.unusedMedia ?? []).map((media) => [media.shotId, media.previewUrl] as const),
        ].map(([id, path]) => [id, sourceUri(path)])));
        setUnusedMedia(film.unusedMedia ?? []);
        setHistory({ snapshots: [edits.ops], index: 0 });
        setSelectedClipId(clipId(film.timeline.videoClips[0]));
        revisionRef.current = edits.revision;
        setSavedRevision(edits.revision);
        savedOpsKeyRef.current = keyOf(edits.ops);
        setSavedOpsKey(savedOpsKeyRef.current);
        setRetryAttempt(0);
        setSave({ state: "saved" });
        setLoaded(true);
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not open the film"); });
    return () => { active = false; };
  }, [projectId, generationId, repository]);

  const timeline = useMemo(() => {
    if (!firstCut) return null;
    const result = applyEdits(firstCut, ops);
    return result.ok ? result.timeline : firstCut;
  }, [firstCut, ops]);

  const persist = useCallback((snapshot: EditOp[]): Promise<boolean> => {
    if (pendingSave.current) return pendingSave.current;
    const attempt = repository.saveEdits(projectId, generationId, revisionRef.current + 1, snapshot)
      .then((document) => {
        revisionRef.current = document.revision;
        setSavedRevision(document.revision);
        savedOpsKeyRef.current = keyOf(snapshot);
        setSavedOpsKey(savedOpsKeyRef.current);
        setRetryAttempt(0);
        setSave({ state: "saved" });
        return true;
      })
      .catch((cause: unknown) => {
        if ((cause as { status?: number }).status === 409) setSave({ state: "conflict" });
        else { setRetryAttempt((count) => count + 1); setSave({ state: "retrying" }); }
        return false;
      })
      .finally(() => { pendingSave.current = null; });
    pendingSave.current = attempt;
    return attempt;
  }, [projectId, generationId, repository]);

  useEffect(() => {
    if (!loaded || !firstCut || opsKey === savedOpsKey || save.state === "conflict" || save.state === "rendering") return;
    if (retryAttempt === 0) setSave({ state: "saving" });
    const delay = retryAttempt ? Math.min(1500 * 2 ** retryAttempt, 12000) : 1500;
    const timer = setTimeout(() => { void persist(ops); }, delay);
    return () => clearTimeout(timer);
  }, [loaded, firstCut, opsKey, savedOpsKey, retryAttempt, save.state === "conflict", save.state === "rendering", persist]);

  const applyMany = useCallback((batch: EditOp[]): boolean => {
    if (!firstCut) return false;
    const next = mergeOps([...opsRef.current, ...batch]);
    const result = applyEdits(firstCut, next);
    if (!result.ok) {
      setEditError("That change couldn’t be applied. Try another edit.");
      return false;
    }
    setEditError(null);
    opsRef.current = next;
    setHistory((current) => ({ snapshots: [...current.snapshots.slice(0, current.index + 1), next], index: current.index + 1 }));
    return true;
  }, [firstCut]);
  const apply = useCallback((op: EditOp): boolean => applyMany([op]), [applyMany]);
  const undo = useCallback(() => setHistory((current) => current.index > 0 ? { ...current, index: current.index - 1 } : current), []);
  const redo = useCallback(() => setHistory((current) => current.index < current.snapshots.length - 1 ? { ...current, index: current.index + 1 } : current), []);
  const reset = useCallback((nextOps: EditOp[] = []) => setHistory((current) => {
    const next = mergeOps(nextOps);
    if (keyOf(current.snapshots[current.index] ?? []) === keyOf(next)) return current;
    return { snapshots: [...current.snapshots.slice(0, current.index + 1), next], index: current.index + 1 };
  }), []);
  const setSource = useCallback((shotId: string, path: string) => setSources((current) => ({ ...current, [shotId]: sourceUri(path) })), []);

  const reloadAfterConflict = useCallback(async () => {
    const edits = await repository.getEdits(projectId, generationId);
    revisionRef.current = edits.revision;
    setSavedRevision(edits.revision);
    savedOpsKeyRef.current = keyOf(edits.ops);
    setSavedOpsKey(savedOpsKeyRef.current);
    setHistory({ snapshots: [edits.ops], index: 0 });
    setRetryAttempt(0);
    setSave({ state: "saved" });
  }, [projectId, generationId, repository]);

  const render = useCallback(async () => {
    if (!loaded || save.state === "conflict") return;
    const requestId = ++renderRequestId.current;
    setDownloadUrl(null);
    setRenderRequest(null);
    while (savedOpsKeyRef.current !== keyOf(opsRef.current)) {
      const saved = await persist(opsRef.current);
      if (!saved) return;
      if (requestId !== renderRequestId.current) return;
    }
    const revision = revisionRef.current;
    setSave({ state: "rendering" });
    try {
      if (revision === 0) {
        const result = await repository.saveFilm(generationId);
        if (requestId !== renderRequestId.current) return;
        setDownloadUrl(result.downloadKey);
        setSave({ state: "ready" });
        return;
      }
      await repository.renderRevision(projectId, generationId, revision);
      if (requestId === renderRequestId.current) setRenderRequest({ revision, requestId });
    } catch {
      if (requestId === renderRequestId.current) setSave({ state: "retrying" });
    }
  }, [loaded, save.state, persist, projectId, generationId, repository]);

  useEffect(() => {
    if (renderRequest === null) return;
    let active = true;
    const check = async () => {
      try {
        const result = await repository.getRender(projectId, generationId, renderRequest.revision);
        if (!active || renderRequest.requestId !== renderRequestId.current) return;
        if (result.status === "ready") { setDownloadUrl(result.downloadUrl ?? null); setSave({ state: "ready" }); setRenderRequest(null); }
        if (result.status === "failed") { setSave({ state: "retrying" }); setRenderRequest(null); }
      } catch { if (active && renderRequest.requestId === renderRequestId.current) { setSave({ state: "retrying" }); setRenderRequest(null); } }
    };
    void check();
    const interval = setInterval(() => { void check(); }, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [renderRequest, projectId, generationId, repository]);

  return {
    timeline, firstCut, sources, unusedMedia, setSource, ops, selectedClipId, select: setSelectedClipId,
    apply, applyMany, undo, redo, reset, canUndo: history.index > 0, canRedo: history.index < history.snapshots.length - 1,
    save, savedRevision, downloadUrl, reloadAfterConflict, render, loaded, error, editError,
  };
}
