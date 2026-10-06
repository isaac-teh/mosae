import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Asset } from "expo-asset";
import { applyEdits, mergeOps, type EditOp, type Timeline } from "@mosae/contracts";
import { getStoryRepository, type EditorMediaItem, type StoryRepository } from "@mosae/core";
import { demoImage } from "./demoAssets";

type SaveState = { state: "saved" | "saving" | "retrying" | "conflict" | "rendering" | "ready" };
type History = { snapshots: EditOp[][]; index: number };

const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const keyOf = (ops: EditOp[]) => JSON.stringify(ops);
const sourceUri = (value: string) => value === "demo:film" ? Asset.fromModule(require("../assets/demo/film.mp4")).uri : value.startsWith("demo:") ? Asset.fromModule(demoImage(value.slice(5))).uri : value;

export function useEditor(projectId: string, generationId: string, repository: StoryRepository = getStoryRepository()) {
  const [firstCut, setFirstCut] = useState<Timeline | null>(null);
  const [sourceDimensions, setSourceDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [sources, setSources] = useState<Record<string, string>>({});
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
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
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const [renderEtaMinutes, setRenderEtaMinutes] = useState<number | null>(null);
  const [savedFilm, setSavedFilm] = useState(false);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const renderRequestId = useRef(0);
  const renderStartedAt = useRef(0);
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
        setSourceDimensions(edits.sourceDimensions ?? {});
        setSources(Object.fromEntries([
          ...Object.entries(film.sources),
          ...(film.unusedMedia ?? []).map((media) => [media.shotId, media.previewUrl] as const),
        ].map(([id, path]) => [id, sourceUri(path)])));
        setThumbnails(Object.fromEntries(Object.entries(film.thumbnails ?? {}).map(([id, path]) => [id, sourceUri(path)])));
        setUnusedMedia(film.unusedMedia ?? []);
        setHistory({ snapshots: [edits.ops], index: 0 });
        setSelectedClipId(null);
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
    if (!result.ok) return firstCut;
    return { ...result.timeline, videoClips: result.timeline.videoClips.map((clip) => {
      if ("source" in clip) {
        const dimensions = sourceDimensions[clip.source.shotId];
        return dimensions ? { ...clip, source: { ...clip.source, ...dimensions } } : clip;
      }
      return { ...clip, spec: { ...clip.spec, slots: clip.spec.slots.map((slot) => {
        const dimensions = slot.shotId ? sourceDimensions[slot.shotId] : undefined;
        return dimensions ? { ...slot, ...dimensions } : slot;
      }) } };
    }) };
  }, [firstCut, ops, sourceDimensions]);

  const persist = useCallback((snapshot: EditOp[]): Promise<boolean> => {
    if (pendingSave.current) return pendingSave.current;
    const attempt = repository.saveEdits(projectId, generationId, revisionRef.current + 1, snapshot)
      .then((document) => {
        setSourceDimensions(document.sourceDimensions ?? {});
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

  const savePendingNow = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = opsRef.current;
      const snapshotKey = keyOf(snapshot);
      if (savedOpsKeyRef.current === snapshotKey) return true;
      if (!await persist(snapshot)) return false;
      if (keyOf(opsRef.current) === snapshotKey) return true;
    }
    return false;
  }, [persist]);

  useEffect(() => {
    if (!loaded || !firstCut || save.state === "conflict" || save.state === "rendering") return;
    if (opsKey === savedOpsKey) {
      if (save.state === "saving" || save.state === "retrying") setSave({ state: "saved" });
      return;
    }
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
    setSourceDimensions(edits.sourceDimensions ?? {});
    setRetryAttempt(0);
    setSave({ state: "saved" });
  }, [projectId, generationId, repository]);

  const render = useCallback(async () => {
    if (!loaded || save.state === "conflict") return;
    const requestId = ++renderRequestId.current;
    setDownloadUrl(null);
    setRenderProgress(null);
    setRenderEtaMinutes(null);
    setRenderRequest(null);
    setSavedFilm(false);
    while (savedOpsKeyRef.current !== keyOf(opsRef.current)) {
      const saved = await persist(opsRef.current);
      if (!saved) return;
      if (requestId !== renderRequestId.current) return;
    }
    const revision = revisionRef.current;
    renderStartedAt.current = Date.now();
    setRenderProgress(0);
    setRenderEtaMinutes(null);
    setSave({ state: "rendering" });
    try {
      if (revision === 0) {
        let observeSaved!: (result: { downloadKey: string }) => void;
        const savedResult = new Promise<{ downloadKey: string }>((resolve) => { observeSaved = resolve; });
        let observing = true;
        let polling = false;
        const pollProgress = async () => {
          if (!observing || polling) return;
          polling = true;
          try {
            const film = await repository.getFilm(generationId);
            const progress = Math.max(0, Math.min(1, film.renderProgress ?? 0));
            setRenderProgress((current) => Math.max(current ?? 0, progress));
            setRenderEtaMinutes(progress > 0 && progress < 1
              ? Math.max(1, Math.ceil(((Date.now() - renderStartedAt.current) * (1 - progress) / progress) / 60_000))
              : null);
            if (film.generationStatus === "saved") observeSaved({ downloadKey: film.videoUrl ?? "" });
          } catch { /* The save promise still reports render failures. */ }
          finally { polling = false; }
        };
        const progressTimer = setInterval(() => { void pollProgress(); }, 1500);
        void pollProgress();
        let result: Awaited<ReturnType<typeof repository.saveFilm>>;
        try {
          result = await Promise.race([repository.saveFilm(generationId), savedResult]);
        } finally {
          observing = false;
          clearInterval(progressTimer);
        }
        if (requestId !== renderRequestId.current) return;
        setDownloadUrl(result.downloadKey);
        setRenderProgress(1);
        setRenderEtaMinutes(null);
        setSave({ state: "ready" });
        setSavedFilm(true);
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
        if (result.status === "ready") { setDownloadUrl(result.downloadUrl ?? null); setRenderProgress(1); setRenderEtaMinutes(null); setSave({ state: "ready" }); setRenderRequest(null); }
        if (result.status === "failed") { setSave({ state: "retrying" }); setRenderRequest(null); }
        if (result.status === "pending" || result.status === "rendering") {
          if (typeof result.renderProgress === "number") {
            const progress = Math.max(0, Math.min(1, result.renderProgress));
            setRenderProgress((current) => Math.max(current ?? 0, progress));
            setRenderEtaMinutes(progress > 0 && progress < 1
              ? Math.max(1, Math.ceil(((Date.now() - renderStartedAt.current) * (1 - progress) / progress) / 60_000))
              : null);
          }
        }
      } catch { if (active && renderRequest.requestId === renderRequestId.current) { setSave({ state: "retrying" }); setRenderRequest(null); } }
    };
    void check();
    const interval = setInterval(() => { void check(); }, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [renderRequest, projectId, generationId, repository]);

  return {
    timeline, firstCut, sources, thumbnails, unusedMedia, setSource, ops, selectedClipId, select: setSelectedClipId,
    apply, applyMany, undo, redo, reset, canUndo: history.index > 0, canRedo: history.index < history.snapshots.length - 1,
    save, savedRevision, getSavedRevision: () => revisionRef.current, getSnapshotKey: () => keyOf(opsRef.current), savePendingNow,
    downloadUrl, renderProgress, renderEtaMinutes, savedFilm, reloadAfterConflict, render, loaded, error, editError,
  };
}
