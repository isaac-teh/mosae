export type EditorSelection = "none" | "slot" | "collage";
export type ContextToolbarAction = "Deselect" | "Music" | "Add" | "Ask" | "Replace" | "Duplicate" | "Delete" | "Layout" | "Motion";

const actions: Record<EditorSelection, ContextToolbarAction[]> = {
  none: ["Music", "Add", "Ask"],
  slot: ["Deselect", "Replace", "Duplicate", "Ask", "Delete"],
  collage: ["Deselect", "Layout", "Motion", "Duplicate", "Delete"],
};

export function contextToolbar(selection: EditorSelection): ContextToolbarAction[] {
  return [...actions[selection]];
}
