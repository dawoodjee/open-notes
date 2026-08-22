import React from 'react';
import { Modal, View } from 'react-native';

/**
 * The dimmed, centred container every confirm-and-name dialog in this app
 * sits in.
 *
 * WHY IT EXISTS -- found on an iPad in landscape, 2026-08-22. Four dialogs had
 * each written the same `absolute inset-0 items-center justify-center bg-black/40`
 * by hand, which centres a dialog inside ITS OWN PARENT. On a phone the parent
 * is the whole screen, so that looks exactly like a screen-level modal and
 * nothing gives the bug away. On a landscape iPad the parent is a 250pt sidebar
 * column, and the New Folder dialog rendered as a narrow box jammed against the
 * left edge of the display, its backdrop dimming one column of a three-column
 * layout. Same code, same phone behaviour, completely wrong on a tablet.
 *
 * React Native's own `Modal` renders into a root view that covers the window
 * regardless of where in the tree it is declared, which is the property the
 * hand-rolled version was missing. It also gives two things for free that none
 * of the four had:
 *
 *  - the Android hardware back button dismisses the dialog;
 *  - on Android the dim covers the status bar rather than stopping under it.
 *
 * `px-8` and `max-w-sm` on the card are kept from the original so nothing moves
 * on a phone. On a wide screen `max-w-sm` is now what limits the width, instead
 * of whichever pane happened to contain it.
 */
export function DialogOverlay({
  onDismiss,
  children,
}: {
  /**
   * Called when the dialog is dismissed by something other than its own
   * buttons -- currently only the Android back button. Every dialog using this
   * already has a Cancel handler, so this is that same handler.
   */
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // iOS ignores `transparent` without this and paints an opaque sheet over
      // the app, which loses the whole point of a dimmed backdrop.
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      {/* Spelled as a style rather than `bg-black/40`, which is what the four
          hand-rolled versions used and which does NOT paint inside an RN
          `Modal` -- verified on an iPad: the dialog centred correctly and the
          app behind it stayed at full brightness. Without the dim the card is
          `bg-background` on `bg-background` and has no visible edge at all. */}
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
        }}
      >
        {children}
      </View>
    </Modal>
  );
}
