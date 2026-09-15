import type { ReactNode } from "react";

type Props = {
  onFiles: (files: File[]) => void;
  onDraggingChange: (dragging: boolean) => void;
  className?: string;
  children: ReactNode;
};

/** Browser drag-and-drop target. Clicks are handled by the Pressable child. */
export function DropZone({
  onFiles,
  onDraggingChange,
  className,
  children,
}: Props) {
  return (
    <div
      className={className}
      onDragOver={(e) => {
        e.preventDefault();
        onDraggingChange(true);
      }}
      onDragLeave={() => onDraggingChange(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDraggingChange(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
    </div>
  );
}
