import React from 'react';
import { FlatList, Text as RNText, View, Platform } from 'react-native';

// Gluestack UI Primitives
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Pressable } from '@/components/ui/pressable';
import { Input, InputField, InputSlot, InputIcon } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';

// Lucide Icons
import { Search, SquarePen } from 'lucide-react-native';

// Custom Types & Helpers
import { Note, parseNoteContent, formatNoteDate } from '@/types/note';

export interface NoteListPaneProps {
  notes: Note[];
  selectedNoteId: string | null;
  searchQuery: string;
  isSidebarTucked: boolean;
  sidebarWidth: number;
  onSelectNote: (id: string) => void;
  onCreateNote: () => void;
  onSearchChange: (query: string) => void;
}

export default function NoteListPane({
  notes,
  selectedNoteId,
  searchQuery,
  isSidebarTucked,
  sidebarWidth,
  onSelectNote,
  onCreateNote,
  onSearchChange,
}: NoteListPaneProps) {
  // Filter Active Notes (Excludes Trashed Notes)
  const activeNotes = notes.filter((n) => !n.isTrashed);

  const filteredNotes = activeNotes.filter(
    (n) =>
      n.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <VStack
      style={
        Platform.OS === 'web' && !isSidebarTucked && selectedNoteId
          ? { width: sidebarWidth }
          : undefined
      }
      className={`
        border-r border-gray-200 bg-gray-50 shrink-0
        ${selectedNoteId ? 'hidden md:flex' : 'w-full flex-1'}
        ${isSidebarTucked ? 'md:hidden' : 'md:w-80'}
      `}
    >
      {/* Header with Top-Right Avatar for Mobile/List view */}
      <HStack className="justify-between items-start p-4 pb-2">
        <VStack>
          <RNText className="text-3xl font-bold text-gray-900">All Notes</RNText>
          <RNText className="text-xs text-gray-500 font-medium mt-0.5">
            {filteredNotes.length} {filteredNotes.length === 1 ? 'Note' : 'Notes'}
          </RNText>
        </VStack>

        {/* Mobile/List Avatar */}
        <Pressable className="md:hidden w-8 h-8 rounded-full bg-lime-100 items-center justify-center border border-lime-300">
          <RNText className="text-xs font-bold text-lime-800">AD</RNText>
        </Pressable>
      </HStack>

      {/* Notes Scroll Area */}
      <FlatList
        data={filteredNotes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 4 }}
        renderItem={({ item: note }) => {
          const { title, preview } = parseNoteContent(note.body);
          const isSelected = note.id === selectedNoteId;

          return (
            <Pressable
              onPress={() => onSelectNote(note.id)}
              className={`p-3 mb-2 rounded-xl transition-colors ${
                isSelected ? 'bg-lime-100/80' : 'bg-white border border-gray-100'
              }`}
            >
              <RNText className="font-semibold text-base text-gray-900" numberOfLines={1}>
                {title}
              </RNText>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 4,
                  width: '100%',
                  minWidth: 0,
                }}
              >
                <RNText
                  className="text-xs text-gray-500 font-medium"
                  style={{ flexShrink: 0 }}
                >
                  {formatNoteDate(new Date(note.updatedAt))}
                  {" "}
                </RNText>

                <RNText
                  className="text-xs text-gray-500"
                  style={{ flex: 1, minWidth: 0 }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {preview}
                </RNText>
              </View>
            </Pressable>
          );
        }}
      />

      {/* Bottom Controls */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 12,
          gap: 12,
          backgroundColor: '#F9FAFB',
          borderTopWidth: 1,
          borderTopColor: '#E5E7EB',
          width: '100%',
        }}
      >
        <Input className="flex-1 rounded-full bg-white border-gray-300 h-10 px-3">
          <InputSlot>
            <InputIcon as={Search} className="text-gray-400 ml-1 shrink-0" />
          </InputSlot>
          <InputField
            placeholder="Search"
            value={searchQuery}
            onChangeText={onSearchChange}
            className="text-sm text-gray-800 flex-1 min-w-0"
          />
        </Input>

        <Pressable
          onPress={onCreateNote}
          className="w-10 h-10 rounded-full bg-lime-500 items-center justify-center active:bg-lime-600 shadow-sm shrink-0"
        >
          <Icon as={SquarePen} className="text-white w-5 h-5" />
        </Pressable>
      </View>
    </VStack>
  );
}
