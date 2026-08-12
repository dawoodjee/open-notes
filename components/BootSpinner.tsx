import { ActivityIndicator, View } from 'react-native';

/**
 * The one frame the app is allowed to show before it has anything real to
 * display.
 *
 * Two places hold launch back, and they run back to back: VaultGate, while the
 * keychain is read and the encrypted database is opened (app/_layout.tsx), and
 * NotesLayout, while the last-opened note is restored and the first query
 * returns. Rendering the same component in both is what makes that read as one
 * uninterrupted load rather than two -- two separately-written spinners can
 * drift in colour, size or centring, and any of those differences shows up as
 * a flicker at the handover precisely because the swap happens mid-load.
 *
 * The spinner is not decoration either. An empty View here is what once made a
 * hung boot look identical to a dead one, with no way to tell "still working"
 * from "gave up" without a debugger.
 */
export function BootSpinner() {
  return (
    <View className="flex-1 bg-background items-center justify-center">
      <ActivityIndicator color="#84CC16" />
    </View>
  );
}
