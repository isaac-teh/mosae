import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditOp } from "@mosae/contracts";
import { useAiEdits } from "../lib/useAiEdits";

describe("useAiEdits", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  it("saves first, applies one complete batch, persists it, then acknowledges", async () => {
    const order: string[] = [];
    let snapshot = "before";
    let revision = 4;
    const ops: EditOp[] = [{ op: "move", clipId: "a", toIndex: 1 }, { op: "setPhotoDuration", clipId: "b", sec: 4 }];
    const repository = {
      getEditConversation: vi.fn(async () => []),
      interpretEdit: vi.fn(async (_p: string, _g: string, _text: string, _revision: number, context?: { scope: { kind: "film" }; requestId: string }) => {
        order.push("interpret"); expect(context?.scope.kind).toBe("film");
        return { kind: "edit" as const, requestId: context!.requestId, baseRevision: 4, reply: "Updated.", ops };
      }),
      acknowledgeEditInterpretation: vi.fn(async () => { order.push("ack"); }),
    } as any;
    const applyMany = vi.fn(() => { order.push("apply"); snapshot = "after"; return true; });
    const undo = vi.fn();
    const savePending = vi.fn(async () => { order.push("save"); revision++; return true; });
    let current!: ReturnType<typeof useAiEdits>;
    function Harness() { current = useAiEdits({ projectId: "p", generationId: "g", repository, savePending,
      getSnapshotKey: () => snapshot, getSavedRevision: () => revision, applyMany, undo, onPlayAt: vi.fn() }); return null; }
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => { await current.submit("shorten and reorder", { kind: "film" }); });
    expect(order).toEqual(["save", "interpret", "apply", "save", "ack"]);
    expect(applyMany).toHaveBeenCalledTimes(1);
    expect(applyMany).toHaveBeenCalledWith(ops);
    expect(current.messages.at(-1)?.status).toBe("applied");
    expect(current.undoableRequestId).toBeTruthy();
    await act(async () => current.undoAiEdit());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(current.undoableRequestId).toBeNull();
  });

  it("rejects a late response after a manual timeline change", async () => {
    let snapshot = "before";
    let resolveInterpret!: (value: any) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const repository = { getEditConversation: async () => [], acknowledgeEditInterpretation: vi.fn(), interpretEdit: vi.fn(() => {
      entered(); return new Promise((resolve) => { resolveInterpret = resolve; });
    }) } as any;
    const applyMany = vi.fn(() => true);
    let current!: ReturnType<typeof useAiEdits>;
    function Harness() { current = useAiEdits({ projectId: "p", generationId: "g", repository, savePending: async () => true,
      getSnapshotKey: () => snapshot, getSavedRevision: () => 2, applyMany, undo: vi.fn(), onPlayAt: vi.fn() }); return null; }
    await act(async () => root.render(React.createElement(Harness)));
    let pending!: Promise<void>;
    await act(async () => { pending = current.submit("change this", { kind: "film" }); await started; });
    snapshot = "manual-change";
    await act(async () => { resolveInterpret({ kind: "edit", requestId: "r", baseRevision: 2, reply: "Done", ops: [{ op: "remove", clipId: "a" }] }); await pending; });
    expect(applyMany).not.toHaveBeenCalled();
    expect(current.messages.at(-1)?.status).toBe("failed");
  });

  it("starts a fresh request after a stale timeline conflict", async () => {
    let snapshot = "before";
    let resolveFirst!: (value: any) => void;
    const contexts: any[] = [];
    const repository = { getEditConversation: async () => [], acknowledgeEditInterpretation: vi.fn(), interpretEdit: vi.fn((_p: string, _g: string, _text: string, _revision: number, context: any) => {
      contexts.push(context);
      return contexts.length === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve({ kind: "unsupported", requestId: context.requestId, reply: "Try something else", ops: [] });
    }) } as any;
    let current!: ReturnType<typeof useAiEdits>;
    function Harness() { current = useAiEdits({ projectId: "p", generationId: "g", repository, savePending: async () => true,
      getSnapshotKey: () => snapshot, getSavedRevision: () => 2, applyMany: vi.fn(() => true), undo: vi.fn(), onPlayAt: vi.fn() }); return null; }
    await act(async () => root.render(React.createElement(Harness)));
    let pending!: Promise<void>;
    await act(async () => { pending = current.submit("change this", { kind: "film" }); });
    snapshot = "manual-change";
    await act(async () => { resolveFirst({ kind: "edit", requestId: contexts[0].requestId, baseRevision: 2, reply: "Done", ops: [{ op: "remove", clipId: "a" }] }); await pending; });
    await act(async () => { await current.submit("change this", { kind: "film" }); });
    expect(contexts).toHaveLength(2);
    expect(contexts[1].requestId).not.toBe(contexts[0].requestId);
    expect(current.messages.at(-1)?.status).toBe("unsupported");
  });

  it("ignores a response after Ask is cancelled", async () => {
    let resolveInterpret!: (value: any) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const repository = { getEditConversation: async () => [], acknowledgeEditInterpretation: vi.fn(), interpretEdit: vi.fn(() => {
      entered(); return new Promise((resolve) => { resolveInterpret = resolve; });
    }) } as any;
    const applyMany = vi.fn(() => true);
    let current!: ReturnType<typeof useAiEdits>;
    function Harness() { current = useAiEdits({ projectId: "p", generationId: "g", repository, savePending: async () => true,
      getSnapshotKey: () => "before", getSavedRevision: () => 2, applyMany, undo: vi.fn(), onPlayAt: vi.fn() }); return null; }
    await act(async () => root.render(React.createElement(Harness)));
    let pending!: Promise<void>;
    await act(async () => { pending = current.submit("change this", { kind: "film" }); await started; current.cancel(); });
    await act(async () => { resolveInterpret({ kind: "edit", requestId: "r", baseRevision: 2, reply: "Done", ops: [{ op: "remove", clipId: "a" }] }); await pending; });
    expect(applyMany).not.toHaveBeenCalled();
    expect(repository.acknowledgeEditInterpretation).not.toHaveBeenCalled();
  });

  it("retries acknowledgement after persistence without applying the same batch twice", async () => {
    let snapshot = "before";
    let revision = 2;
    const ops: EditOp[] = [{ op: "remove", clipId: "a" }];
    const repository = {
      getEditConversation: async () => [],
      interpretEdit: vi.fn(async (_p: string, _g: string, _text: string, _revision: number, context: any) => ({ kind: "edit" as const, requestId: context.requestId, baseRevision: 2, reply: "Done", ops })),
      acknowledgeEditInterpretation: vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined),
    } as any;
    const applyMany = vi.fn(() => { snapshot = "after"; return true; });
    const undo = vi.fn(() => { snapshot = "before"; });
    const savePending = vi.fn(async () => { revision++; return true; });
    let current!: ReturnType<typeof useAiEdits>;
    function Harness() { current = useAiEdits({ projectId: "p", generationId: "g", repository, savePending,
      getSnapshotKey: () => snapshot, getSavedRevision: () => revision, applyMany, undo, onPlayAt: vi.fn() }); return null; }
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => { await current.submit("remove this", { kind: "film" }); });
    expect(current.messages.at(-1)?.status).toBe("failed");
    await act(async () => { await current.submit("remove this", { kind: "film" }); });
    expect(applyMany).toHaveBeenCalledTimes(1);
    expect(repository.acknowledgeEditInterpretation).toHaveBeenCalledTimes(2);
    expect(current.messages.at(-1)?.status).toBe("applied");
  });

  it("does not expose the AI undo after a later manual snapshot replaces it", async () => {
    let snapshot = "before";
    const repository = { getEditConversation: async () => [], interpretEdit: async (_p: string, _g: string, _text: string, _revision: number, context: any) => ({ kind: "edit" as const, requestId: context.requestId, baseRevision: 1, reply: "Done", ops: [{ op: "remove" as const, clipId: "a" }] }), acknowledgeEditInterpretation: async () => {} } as any;
    let current!: ReturnType<typeof useAiEdits>;
    const undo = vi.fn();
    function Harness() { current = useAiEdits({ projectId: "p", generationId: "g", repository, savePending: async () => true,
      getSnapshotKey: () => snapshot, getSavedRevision: () => 1, applyMany: () => { snapshot = "ai-edit"; return true; }, undo, onPlayAt: vi.fn() }); return null; }
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => { await current.submit("remove this", { kind: "film" }); });
    expect(current.undoableRequestId).toBeTruthy();
    snapshot = "manual-edit";
    await act(async () => root.render(React.createElement(Harness)));
    expect(current.undoableRequestId).toBeNull();
    await act(async () => current.undoAiEdit());
    expect(undo).not.toHaveBeenCalled();
  });
});
