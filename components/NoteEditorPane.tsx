import React from 'react';
import { Text as RNText } from 'react-native';
import RichEditor from './RichEditor';

// Gluestack UI Primitives
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import { Box } from '@/components/ui/box';

import {
  Menu as UIComponentsMenu,
  MenuItem,
  MenuItemLabel,
} from '@/components/ui/menu';

// Lucide Icons
import {
  ChevronLeft,
  Share,
  Menu,
  Trash2,
  MoreVertical,
} from 'lucide-react-native';

// Custom Types
import { Note } from '@/types/note';

export interface NoteEditorPaneProps {
  selectedNote: Note | undefined;
  selectedNoteId: string | null;
  isSidebarTucked: boolean;
  onToggleSidebar: () => void;
  onBackToList: () => void;
  onTrashNote: (id: string) => void;
  onNoteChange: (html: string) => void;
  initialEditorScrollOffset?: number;
  onEditorScrollOffsetChange?: (offset: number) => void;
}

export default function NoteEditorPane({
  selectedNote,
  selectedNoteId,
  isSidebarTucked,
  onToggleSidebar,
  onBackToList,
  onTrashNote,
  onNoteChange,
  initialEditorScrollOffset,
  onEditorScrollOffsetChange,
}: NoteEditorPaneProps) {
  return (
    <VStack
      className={`
        flex-1 bg-white
        ${!selectedNoteId ? 'hidden md:flex' : 'w-full flex-1'}
      `}
    >
      {selectedNote ? (
        <>
          {/* Top Navigation Row */}
          <HStack className="justify-between items-center px-4 py-3 border-b border-gray-100">
            <HStack className="items-center space-x-1">
              {/* Mobile Back Button */}
              <Pressable
                onPress={onBackToList}
                className="md:hidden flex-row items-center"
              >
                <Icon as={ChevronLeft} className="text-gray-600 w-6 h-6" />
              </Pressable>

              {/* Desktop Sidebar Tuck/Untuck Toggle */}
              <Pressable
                onPress={onToggleSidebar}
                className="hidden md:flex p-1.5 rounded-md hover:bg-gray-100"
              >
                <Icon as={Menu} className="text-gray-600 w-5 h-5" />
              </Pressable>
            </HStack>

            {/* Header Actions */}
            <HStack className="items-center space-x-3">
              {/* Share Action */}
              <Pressable className="p-1.5 rounded-full hover:bg-gray-100">
                <Icon as={Share} className="text-gray-600 w-5 h-5" />
              </Pressable>

              {/* More Options (...) Menu */}
              <UIComponentsMenu
                placement="bottom right"
                offset={8}
                trigger={({ ...triggerProps }) => (
                  <Pressable
                    {...triggerProps}
                    className="p-1.5 rounded-full hover:bg-gray-100 mr-2"
                  >
                    <Icon as={MoreVertical} className="text-gray-600 w-5 h-5" />
                  </Pressable>
                )}
              >
                <MenuItem
                  key="trash"
                  textValue="Delete"
                  onPress={() => onTrashNote(selectedNote.id)}
                  className="p-2.5 flex-row items-center gap-2"
                >
                  <Icon as={Trash2} className="text-red-500 w-4 h-4" />
                  <MenuItemLabel className="text-sm font-medium text-red-600">
                    Delete
                  </MenuItemLabel>
                </MenuItem>
              </UIComponentsMenu>

              {/* Desktop Avatar */}
              <Pressable className="hidden md:flex w-8 h-8 rounded-full bg-lime-100 items-center justify-center border border-lime-300">
                <RNText className="text-xs font-bold text-lime-800">AD</RNText>
              </Pressable>
            </HStack>
          </HStack>

          {/* Editor Detail Pane */}
          <Box className="flex-1">
            <RichEditor
              key={selectedNote.id}
              initialContent={selectedNote.body}
              onChange={onNoteChange}
              autoFocus={!selectedNote.body || selectedNote.body === ''}
              initialScrollOffset={initialEditorScrollOffset}
              onScrollOffsetChange={onEditorScrollOffsetChange}
            />
          </Box>
        </>
      ) : (
        <VStack className="flex-1 items-center justify-center p-4 bg-gray-50/50">
          <RNText className="text-gray-400 text-base font-medium">
            Select a note or create a new one.
          </RNText>
        </VStack>
      )}
    </VStack>
  );
}
