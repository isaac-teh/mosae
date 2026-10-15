import { useCallback, useEffect, useRef, useState } from "react";
import type { EditOp } from "@mosae/contracts";
import type { EditInterpretContext, EditInterpretation, EditScope, EditConversationTurn, StoryRepository } from "@mosae/core";

export type AiEditMessage = { requestId: string; text: string; reply: string; status: "pending" | "applied" | "clarify" | "unsupported" | "failed"; ops?: EditOp[] };
type PendingRequest = { requestId: string; text: string; scope: EditScope; snapshotKey: string };

export function useAiEdits(options: {
  projectId: string; generationId: string; repository: Pick<StoryRepository, "interpretEdit" | "getEditConversation" | "acknowledgeEditInterpretation">;
  savePending: () => Promise<boolean>; getSnapshotKey: () => string; getSavedRevision: () => number;
  applyMany: (ops: EditOp[]) => boolean; undo: () => void; onPlayAt: (ops: EditOp[]) => void;
  onApplied?: (ops: EditOp[], reply: string, requestText: string, scope: EditScope) => void;
}) {
  const [messages, setMessages] = useState<AiEditMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoableRequestId, setUndoableRequestId] = useState<string | null>(null);
  const epoch = useRef(0);
  const pendingRetry = useRef<PendingRequest | null>(null);
  const applied = useRef(new Map<string, string>());
  const snapshotKey = options.getSnapshotKey();

  useEffect(() => {
    if (undoableRequestId && applied.current.get(undoableRequestId) !== snapshotKey) setUndoableRequestId(null);
  }, [snapshotKey, undoableRequestId]);

  const undoAiEdit = useCallback(() => {
    if (!undoableRequestId || applied.current.get(undoableRequestId) !== options.getSnapshotKey()) return;
    options.undo();
    applied.current.delete(undoableRequestId);
    setUndoableRequestId(null);
  }, [options, undoableRequestId]);

  const cancel = useCallback(() => { epoch.current++; setBusy(false); }, []);

  useEffect(() => {
    const current = ++epoch.current;
    pendingRetry.current = null;
    applied.current.clear();
    setUndoableRequestId(null);
    setMessages([]); setError(null); setBusy(false);
    void options.repository.getEditConversation(options.projectId, options.generationId)
      .then((turns: EditConversationTurn[]) => {
        if (epoch.current !== current) return;
        setMessages(turns.map((turn) => ({ requestId: turn.requestId, text: turn.user, reply: turn.reply,
          status: turn.status === "applied" ? "applied" : turn.kind === "clarify" ? "clarify" : turn.kind === "unsupported" ? "unsupported" : turn.status === "failed" ? "failed" : "pending" })));
      }).catch(() => { /* The current request still loads on submit. */ });
    return () => { if (epoch.current === current) epoch.current++; };
  }, [options.projectId, options.generationId, options.repository]);

  const submit = useCallback(async (rawText: string, scope: EditScope) => {
    const text = rawText.trim();
    if (!text || busy) return;
    const request = pendingRetry.current?.text === text && JSON.stringify(pendingRetry.current.scope) === JSON.stringify(scope)
      ? pendingRetry.current : { requestId: `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`, text, scope, snapshotKey: options.getSnapshotKey() };
    pendingRetry.current = request;
    const activeEpoch = ++epoch.current;
    setBusy(true); setError(null);
    const updateMessage = (message: AiEditMessage) => setMessages((current) => [...current.filter((item) => item.requestId !== message.requestId), message]);
    updateMessage({ requestId: request.requestId, text, reply: "Working on your edit…", status: "pending" });
    try {
      if (!await options.savePending()) throw new Error("save_failed");
      if (epoch.current !== activeEpoch) return;
      const previouslyApplied = applied.current.get(request.requestId);
      if (options.getSnapshotKey() !== (previouslyApplied ?? request.snapshotKey)) throw new Error("edits_changed");
      const revision = options.getSavedRevision();
      const context: EditInterpretContext = { scope, requestId: request.requestId };
      const result = await options.repository.interpretEdit(options.projectId, options.generationId, text, revision, context);
      if (epoch.current !== activeEpoch) return;
      if (options.getSnapshotKey() !== (applied.current.get(request.requestId) ?? request.snapshotKey)) throw new Error("edits_changed");
      if (result.kind !== "edit") {
        pendingRetry.current = null;
        updateMessage({ requestId: request.requestId, text, reply: result.reply, status: result.kind });
        return;
      }
      const previousApply = applied.current.get(request.requestId);
      if (previousApply !== undefined && previousApply !== options.getSnapshotKey()) throw new Error("edits_changed");
      if (previousApply === undefined) {
        if (!options.applyMany(result.ops)) throw new Error("apply_failed");
        applied.current.set(request.requestId, options.getSnapshotKey());
        setUndoableRequestId(request.requestId);
      }
      if (!await options.savePending()) {
        if (applied.current.get(request.requestId) === options.getSnapshotKey()) { options.undo(); applied.current.delete(request.requestId); }
        throw new Error("save_failed");
      }
      if (epoch.current !== activeEpoch) return;
      const appliedRevision = options.getSavedRevision();
      await options.repository.acknowledgeEditInterpretation(options.projectId, options.generationId, request.requestId, appliedRevision);
      if (epoch.current !== activeEpoch) return;
      pendingRetry.current = null;
      updateMessage({ requestId: request.requestId, text, reply: result.reply, status: "applied", ops: result.ops });
      options.onApplied?.(result.ops, result.reply, text, scope);
    } catch (cause) {
      if (epoch.current !== activeEpoch) return;
      const errorCode = cause && typeof cause === "object" && "code" in cause ? (cause as { code?: unknown }).code : undefined;
      const staleRevision = errorCode === "stale_revision" || (cause instanceof Error && cause.message === "stale_revision");
      const message = cause instanceof Error && cause.message === "edits_changed"
        ? "Your timeline changed while Ask AI was working. Try again with the current edit."
        : staleRevision
          ? "Another edit was saved while Ask AI was working. Reload the saved film before asking again."
        : cause instanceof Error && cause.message === "save_failed"
          ? "Could not save this edit. Your timeline is unchanged; try again."
          : "Could not apply that edit. Try again.";
      if ((cause instanceof Error && cause.message === "edits_changed") || staleRevision) pendingRetry.current = null;
      setError(message);
      updateMessage({ requestId: request.requestId, text, reply: message, status: "failed" });
    } finally { if (epoch.current === activeEpoch) setBusy(false); }
  }, [busy, options]);

  return { messages, busy, error, submit, cancel, undoableRequestId, undoAiEdit };
}
