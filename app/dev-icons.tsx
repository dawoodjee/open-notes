/**
 * DEV-ONLY ICON-BUTTON HARNESS. Reachable at /dev-icons. Not linked from anywhere.
 *
 * WHY THIS EXISTS. The icon-button system has five states, three shapes and two
 * kinds of disabled, and most of them only appear under a pointer or a finger.
 * Verifying them by hunting for one real example of each across twenty screens
 * means most of the matrix never actually gets looked at -- which is how the
 * app ended up with two hover-only buttons that have no press feedback at all
 * on a phone, unnoticed since they were written.
 *
 * This puts the whole matrix on one screen, so one screenshot is a complete
 * result and an accessibility-text-size run is one relaunch rather than twenty.
 *
 * Same shape as app/dev-swipe.tsx, and the same `__DEV__` guard: route files
 * are bundled in release builds too, so without it this is reachable in a
 * shipped app over the notes://dev-icons deep link.
 */
import React, { useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';
import {
  ArrowLeft,
  Bold,
  Check,
  Highlighter,
  Indent,
  Italic,
  List,
  MoreHorizontal,
  Redo2,
  Share as ShareIcon,
  Strikethrough,
  Table,
  Underline,
  Undo2,
} from 'lucide-react-native';

import { IconButton, IconButtonBar, IconButtonGroup, SURFACE } from '@/components/IconButton';

export default function DevIcons() {
  if (!__DEV__) return null;
  return <Harness />;
}

function Row({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 26 }}>
      <RNText className="text-sm font-semibold text-foreground" style={{ marginBottom: 2 }}>
        {title}
      </RNText>
      {note ? (
        <RNText className="text-xs text-muted-foreground" style={{ marginBottom: 8 }}>
          {note}
        </RNText>
      ) : (
        <View style={{ height: 8 }} />
      )}
      {children}
    </View>
  );
}

function Harness() {
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [pressCount, setPressCount] = useState(0);

  return (
    <ScrollView
      className="bg-background"
      contentContainerStyle={{ padding: 16, paddingTop: 64, paddingBottom: 64 }}
    >
      <RNText className="text-2xl font-bold text-foreground">icon-button harness</RNText>
      <RNText className="text-xs text-muted-foreground" style={{ marginBottom: 20 }}>
        surface {SURFACE}pt · glyph 20pt · touch target 44pt via hitSlop · presses: {pressCount}
      </RNText>

      <Row
        title="Shape follows grouping"
        note="one icon = circle · related icons = ONE capsule · accent stands alone"
      >
        <IconButtonBar>
          <IconButtonGroup>
            <IconButton icon={ArrowLeft} label="Back" onPress={() => setPressCount((n) => n + 1)} />
          </IconButtonGroup>
          <IconButtonGroup>
            <IconButton icon={Undo2} label="Undo" onPress={() => setPressCount((n) => n + 1)} />
          </IconButtonGroup>
          <IconButtonGroup>
            <IconButton icon={ShareIcon} label="Share" onPress={() => setPressCount((n) => n + 1)} />
            <IconButton icon={MoreHorizontal} label="Menu" onPress={() => setPressCount((n) => n + 1)} />
          </IconButtonGroup>
          <IconButton
            icon={Check}
            label="Done"
            variant="accent"
            onPress={() => setPressCount((n) => n + 1)}
          />
        </IconButtonBar>
      </Row>

      <Row
        title="Selected vs rest, inside one capsule"
        note="tap B and I — selected is a filled accent CIRCLE, not just a tint"
      >
        <IconButtonGroup>
          <IconButton icon={Bold} label="Bold" selected={bold} onPress={() => setBold((v) => !v)} />
          <IconButton icon={Italic} label="Italic" selected={italic} onPress={() => setItalic((v) => !v)} />
          <IconButton icon={Underline} label="Underline" onPress={() => setPressCount((n) => n + 1)} />
          <IconButton icon={Strikethrough} label="Strikethrough" onPress={() => setPressCount((n) => n + 1)} />
        </IconButtonGroup>
      </Row>

      <Row
        title="Two kinds of disabled — identical on purpose"
        note="left: the editor cannot do it yet. right: not applicable at the caret. they differ only in the accessibility hint."
      >
        <IconButtonBar>
          <IconButtonGroup>
            <IconButton
              icon={Highlighter}
              label="Highlight"
              disabled
              disabledReason="Not available in this editor yet"
            />
            <IconButton
              icon={Indent}
              label="Indent"
              disabled
              disabledReason="Not available in this editor yet"
            />
            <IconButton
              icon={Table}
              label="Table"
              disabled
              disabledReason="Not available in this editor yet"
            />
          </IconButtonGroup>
          <IconButtonGroup>
            <IconButton
              icon={Bold}
              label="Bold"
              disabled
              disabledReason="Not available inside a code block"
            />
            <IconButton
              icon={List}
              label="Bulleted list"
              disabled
              disabledReason="Not available inside a code block"
            />
          </IconButtonGroup>
        </IconButtonBar>
      </Row>

      <Row
        title="A group whose members are conditional"
        note="Redo is absent until something is undone — one surviving child collapses to a circle on its own"
      >
        <IconButtonBar>
          <IconButtonGroup>
            <IconButton icon={Undo2} label="Undo" onPress={() => setPressCount((n) => n + 1)} />
          </IconButtonGroup>
          <IconButtonGroup>
            <IconButton icon={Undo2} label="Undo" onPress={() => setPressCount((n) => n + 1)} />
            <IconButton icon={Redo2} label="Redo" onPress={() => setPressCount((n) => n + 1)} />
          </IconButtonGroup>
        </IconButtonBar>
      </Row>

      <Row title="Optical line" note="circles and capsules on one row share a height and sit on one baseline">
        <View className="bg-foreground/5" style={{ padding: 12, borderRadius: 12 }}>
          <IconButtonBar>
            <IconButtonGroup>
              <IconButton icon={ArrowLeft} label="Back" onPress={() => setPressCount((n) => n + 1)} />
            </IconButtonGroup>
            <IconButtonGroup>
              <IconButton icon={Bold} label="Bold" selected onPress={() => setPressCount((n) => n + 1)} />
              <IconButton icon={Italic} label="Italic" onPress={() => setPressCount((n) => n + 1)} />
              <IconButton icon={Underline} label="Underline" onPress={() => setPressCount((n) => n + 1)} />
            </IconButtonGroup>
            <IconButton icon={Check} label="Done" variant="accent" onPress={() => setPressCount((n) => n + 1)} />
          </IconButtonBar>
        </View>
      </Row>
    </ScrollView>
  );
}
