import React from 'react';
import { View, ViewProps } from 'react-native';
import { OverlayProvider } from '@gluestack-ui/core/overlay/creator';
import { ToastProvider } from '@gluestack-ui/core/toast/creator';

export type ModeType = 'light' | 'dark' | 'system';

/**
 * MODIFIED FROM THE GENERATED GLUESTACK FILE -- if you regenerate this
 * component, re-apply this change.
 *
 * As shipped, this ran `Appearance.setColorScheme(mode as ColorSchemeName)` in
 * an effect. Two problems, and the `as` cast is hiding both:
 *
 *  - 'system' is not a ColorSchemeName. Following the OS is spelled `null`, so
 *    the default value of this very prop was never doing what it claimed.
 *  - More seriously, it made this a SECOND writer to a single global setting.
 *    contexts/ThemeContext.tsx is the owner: it sets null for "follow the
 *    device". This provider then immediately overwrote that with the resolved
 *    'light' or 'dark' -- which pins the app to that value, so the OS
 *    switching between light and dark stopped reaching the app at all. The
 *    theme looked correct at launch and then never moved.
 *
 * The effect is gone. `mode` is accepted only so the prop remains valid for
 * any generated call site; it no longer drives anything. Appearance has one
 * owner, and it is ThemeContext.
 */
export function GluestackUIProvider({
  mode: _mode = 'system',
  ...props
}: {
  mode?: ModeType;
  children?: React.ReactNode;
  style?: ViewProps['style'];
}) {
  return (
    <View
      style={[
        { flex: 1, height: '100%', width: '100%' },
        props.style,
      ]}
    >
      <OverlayProvider>
        <ToastProvider>{props.children}</ToastProvider>
      </OverlayProvider>
    </View>
  );
}
