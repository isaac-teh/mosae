export type EditorSelection = "none" | "slot" | "collage" | "collageCell" | "audio";
export type ContextToolbarAction = "Deselect" | "Back" | "Music" | "Add" | "Ask" | "Replace" | "ReplaceCell" | "AddCell" | "Duplicate" | "Delete" | "Remove" | "Volume" | "Layout" | "Motion";

const actions: Record<EditorSelection, ContextToolbarAction[]> = {
  none: ["Ask"],
  slot: ["Remove", "Replace"],
  collage: ["Remove", "Layout"],
  collageCell: ["Remove", "ReplaceCell"],
  audio: ["Volume", "Replace"],
};

export function contextToolbar(selection: EditorSelection): ContextToolbarAction[] {
  return [...actions[selection]];
}
