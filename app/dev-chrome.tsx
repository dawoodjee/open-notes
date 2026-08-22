/**
 * DEV-ONLY DESKTOP-CHROME HARNESS. Reachable at /dev-chrome. Not linked.
 *
 * WHY IT EXISTS. Stage 12b got web booting only as far as the app's own
 * BootFailureScreen -- no keychain on web, no native SQLite -- so there was no
 * way to put a REAL note behind the desktop bar. Stage 12g fixed that: web now
 * runs the real app against a memory-only database.
 *
 * The harness stays, and is still the right place to work on chrome. A fixture
 * gives every state on demand -- both panes hidden, a long scrolled document,
 * an overlapped title -- where the real app gives whichever one the current
 * data happens to produce. It also renders when the database does not open,
 * which is exactly when a chrome bug is hardest to look at.
 *
 * Everything this stage has to prove is about the bar and the pane matrix, not
 * about the data:
 *   - the title is not overlapped on a new note, and IS once you scroll
 *   - all four minimize/restore combinations put the restore control in the
 *     right pane, and only ever in one of them
 *   - search and New Note are reachable again after Stage 11 removed them
 *
 * Fixture text answers all three. Same `__DEV__` guard as /dev-swipe and
 * /dev-icons: route files are bundled into release builds too.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { BAR_HEIGHT, DesktopTopBar } from '@/components/DesktopTopBar';
import { paneChrome, restoreControlCount } from '@/lib/layout/paneChrome';

export default function DevChrome() {
  if (!__DEV__) return null;
  return <Harness />;
}

/** Long enough to scroll, so the overlap-on-scroll rule is actually testable. */
const PARAGRAPHS = Array.from({ length: 14 }, (_, i) =>
  `Paragraph ${i + 1}. The bar above floats over this document rather than sitting in a row ` +
  `of its own, so this text passes underneath it as the note scrolls. At rest the title must ` +
  `be clear of it entirely.`
);

function Harness() {
  const [foldersVisible, setFolders] = useState(true);
  const [listVisible, setList] = useState(true);
  const [query, setQuery] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [scrolled, setScrolled] = useState(false);

  const chrome = paneChrome({ foldersVisible, listVisible });
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 6));

  return (
    <View className="flex-1 bg-background">
      {/* The state switches sit ABOVE the simulated window so they never
          overlap the thing under test. */}
      <View className="border-b border-border px-4 py-3" style={{ gap: 8 }}>
        <RNText className="text-lg font-bold text-foreground">dev-chrome harness</RNText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Toggle label="Folders" on={foldersVisible} onPress={() => setFolders((v) => !v)} />
          <Toggle label="List" on={listVisible} onPress={() => setList((v) => !v)} />
        </View>
        <RNText
          className={
            restoreControlCount({ foldersVisible, listVisible }) ===
            (foldersVisible && listVisible ? 0 : 1)
              ? 'text-xs text-lime-600 dark:text-lime-400'
              : 'text-xs text-destructive'
          }
        >
          restore controls: {restoreControlCount({ foldersVisible, listVisible })} · list-pane
          restore: {String(chrome.listPaneShowsRestoreFolders)} · editor restore:{' '}
          {String(chrome.editorShowsRestorePanes)} · title overlapped: {String(scrolled)}
        </RNText>
        {log.length ? (
          <RNText className="text-xs text-muted-foreground">{log.join('  ·  ')}</RNText>
        ) : null}
      </View>

      {/* A simulated desktop window: the two panes, then the editor with the
          floating bar over it. */}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {foldersVisible ? (
          <View className="border-r border-border bg-secondary" style={{ width: 220 }}>
            <PaneHeader
              title="Folders"
              trailing={
                chrome.folderPaneShowsNewFolder ? 'New Folder · Collapse' : undefined
              }
            />
          </View>
        ) : null}

        {listVisible ? (
          <View className="border-r border-border" style={{ width: 280 }}>
            <PaneHeader
              title="All Notes"
              leading={chrome.listPaneShowsRestoreFolders ? 'Restore folders' : undefined}
              trailing={chrome.listPaneShowsCollapse ? 'Collapse' : undefined}
            />
          </View>
        ) : null}

        <View style={{ flex: 1 }}>
          <DesktopTopBar
            chrome={chrome}
            onRestorePanes={() => {
              setList(true);
              note('restore panes');
            }}
            onNewNote={() => note('new note')}
            onShare={() => note('share')}
            searchQuery={query}
            onSearchChange={setQuery}
            onTextStyles={() => note('text styles')}
            onChecklist={() => note('checklist')}
          />
          <ScrollView
            // The whole point of the inset: at rest the title clears the bar.
            contentContainerStyle={{ paddingTop: BAR_HEIGHT + 16, paddingHorizontal: 24, paddingBottom: 48 }}
            scrollEventThrottle={16}
            onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 8)}
          >
            <RNText className="text-3xl font-bold text-foreground" style={{ marginBottom: 12 }}>
              Sample Note
            </RNText>
            {PARAGRAPHS.map((p, i) => (
              <RNText key={i} className="text-base text-foreground" style={{ marginBottom: 12 }}>
                {p}
              </RNText>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

function PaneHeader({
  title,
  leading,
  trailing,
}: {
  title: string;
  leading?: string;
  trailing?: string;
}) {
  return (
    <View className="px-3 py-3 border-b border-border" style={{ gap: 4 }}>
      {leading ? <RNText className="text-[10px] text-lime-600 dark:text-lime-400">◀ {leading}</RNText> : null}
      <RNText className="text-base font-semibold text-foreground">{title}</RNText>
      {trailing ? <RNText className="text-[10px] text-muted-foreground">{trailing}</RNText> : null}
    </View>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-xl px-3 py-2 ${on ? 'bg-lime-500' : 'bg-foreground/10'}`}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${on ? 'shown' : 'hidden'}`}
    >
      <RNText className={on ? 'text-xs text-on-accent font-semibold' : 'text-xs text-foreground'}>
        {label}: {on ? 'shown' : 'hidden'}
      </RNText>
    </Pressable>
  );
}
