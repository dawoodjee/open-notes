/**
 * DEV-ONLY SWIPE HARNESS. Reachable at /dev-swipe. Not linked from anywhere.
 *
 * WHY THIS EXISTS. Swipe rows could not be tested without a human. Synthesised
 * touches drive React Native's own touch handling but never fire
 * `UIGestureRecognizer`s, so on the iOS Simulator an automated swipe registers
 * as a tap and the gesture looks dead when it is fine. That cost two native
 * rebuilds and a dependency bump once, and it let a genuinely broken Pin action
 * ship until it was caught by hand.
 *
 * The insight this is built on: injected TAPS work on both platforms. Only the
 * OPENING cannot be automated. So the harness opens the row through the
 * `testOpen` seam and then taps the revealed actions for real -- which means
 * the thing under test is still the real hit-testing, the part that actually
 * broke.
 *
 * Each action reports whether its callback fired. A button that renders but
 * does not respond -- exactly the Pin bug -- shows up as a FAIL here in one
 * run instead of an hour of guessing.
 *
 * Results render on screen AND are POSTed to a local collector when one is
 * listening, so a run can be read as exact text rather than squinted at.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { SwipeableNoteRow } from '@/components/SwipeableNoteRow';

const COLLECTOR = 'http://localhost:9999';

type Fired = Record<string, number>;

const ACTIONS = ['pin', 'share', 'move', 'delete'] as const;
type ActionName = (typeof ACTIONS)[number];

/** Which side each action lives on, so the harness knows how to reveal it. */
const SIDE: Record<ActionName, 'left' | 'right'> = {
  pin: 'left',
  share: 'right',
  move: 'right',
  delete: 'right',
};

export default function DevSwipe() {
  const [fired, setFired] = useState<Fired>({});
  const [open, setOpen] = useState<'left' | 'right' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const record = useCallback((name: ActionName) => {
    // Firing an action closes the row, so the harness has to let go of
    // `testOpen` too. Without this it still reads 'right' while the row is
    // shut, and pressing "open right" again sets the same value -- React skips
    // the re-render, the effect never re-runs, and the next action tap lands on
    // nothing. That looked exactly like a broken button on the first run.
    setOpen(null);
    setFired((f) => ({ ...f, [name]: (f[name] ?? 0) + 1 }));
    setLog((l) => [`fired: ${name}`, ...l].slice(0, 12));
    void fetch(COLLECTOR, {
      method: 'POST',
      body: JSON.stringify({ kind: 'swipe-action', name, at: Date.now() }),
    }).catch(() => {});
  }, []);

  const reset = useCallback(() => {
    setFired({});
    setLog([]);
    setOpen(null);
    setOpenId(null);
  }, []);

  /**
   * A run is judged by whether every action fired at least once. Reported as
   * one line so a screenshot of the harness is a complete result.
   */
  const verdict = useMemo(() => {
    const missing = ACTIONS.filter((a) => !fired[a]);
    if (Object.keys(fired).length === 0) return 'no actions fired yet';
    return missing.length === 0 ? 'PASS all 4 actions fired' : `FAIL not fired: ${missing.join(', ')}`;
  }, [fired]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#111' }} contentContainerStyle={{ padding: 12, paddingTop: 60 }}>
      <RNText style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>dev-swipe harness</RNText>
      <RNText
        style={{
          color: verdict.startsWith('PASS') ? '#84cc16' : verdict.startsWith('FAIL') ? '#ef4444' : '#999',
          fontSize: 15,
          marginTop: 4,
          marginBottom: 10,
        }}
      >
        {verdict}
      </RNText>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <Btn label="open left (Pin)" onPress={() => { setOpen('left'); setOpenId('row'); }} />
        <Btn label="open right (3)" onPress={() => { setOpen('right'); setOpenId('row'); }} />
        <Btn label="close" onPress={() => { setOpen(null); setOpenId(null); }} />
        <Btn label="reset" onPress={reset} />
      </View>

      <RNText style={{ color: '#999', marginBottom: 6 }}>
        state: open={String(open)} · counts={JSON.stringify(fired)}
      </RNText>

      {/* The row under test. Real component, real actions, real hit-testing --
          only the opening is synthetic. */}
      <View style={{ marginBottom: 16 }}>
        <SwipeableNoteRow
          id="row"
          isPinned={false}
          openId={openId}
          onOpenChange={setOpenId}
          testOpen={open}
          onPin={() => record('pin')}
          onShare={() => record('share')}
          onMove={() => record('move')}
          onDelete={() => record('delete')}
        >
          <View style={{ backgroundColor: '#222', padding: 16, minHeight: 72, justifyContent: 'center' }}>
            <RNText style={{ color: '#fff', fontWeight: '600' }}>Row under test</RNText>
            <RNText style={{ color: '#888', fontSize: 12 }}>swipe by hand, or use the buttons above</RNText>
          </View>
        </SwipeableNoteRow>
      </View>

      <RNText style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>recent</RNText>
      {log.map((line, i) => (
        <RNText key={i} style={{ color: '#bbb', fontSize: 12 }}>
          {line}
        </RNText>
      ))}
      {log.length === 0 ? <RNText style={{ color: '#555', fontSize: 12 }}>(nothing yet)</RNText> : null}

      <RNText style={{ color: '#555', fontSize: 11, marginTop: 20 }}>
        SIDE map: {JSON.stringify(SIDE)}
      </RNText>
    </ScrollView>
  );
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: '#333', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <RNText style={{ color: '#fff', fontSize: 13 }}>{label}</RNText>
    </Pressable>
  );
}
