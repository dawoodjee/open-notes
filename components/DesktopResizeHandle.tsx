import React from 'react';
import { Platform } from 'react-native';

export interface DesktopResizeHandleProps {
  isSidebarTucked: boolean;
  selectedNoteId: string | null;
  onStartResizing: () => void;
}

export default function DesktopResizeHandle({
  isSidebarTucked,
  selectedNoteId,
  onStartResizing,
}: DesktopResizeHandleProps) {
  if (Platform.OS !== 'web' || isSidebarTucked || !selectedNoteId) {
    return null;
  }

  return (
    <div
      onMouseDown={onStartResizing}
      className="hidden md:block w-1 hover:w-1.5 cursor-col-resize bg-transparent hover:bg-lime-400 transition-all z-10"
      title="Drag to resize panel"
    />
  );
}
