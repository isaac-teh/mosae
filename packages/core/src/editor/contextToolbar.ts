export type EditorSelection = "none" | "slot" | "collage" | "collageCell";
export type ContextToolbarAction = "Deselect" | "Back" | "Music" | "Add" | "Ask" | "Replace" | "ReplaceCell" | "RemoveCell" | "AddCell" | "Duplicate" | "Delete" | "Layout" | "Motion";

const actions: Record<EditorSelection, ContextToolbarAction[]> = {
  none: ["Music", "Add", "Ask"],
  slot: ["Deselect", "Replace", "Duplicate", "Ask", "Delete"],
  collage: ["Deselect", "Layout", "AddCell", "Motion", "Duplicate", "Delete"],
  collageCell: ["Back", "ReplaceCell", "RemoveCell"],
};

export function contextToolbar(selection: EditorSelection): ContextToolbarAction[] {
  return [...actions[selection]];
}
