#!/usr/bin/env bash
#
# Build the iOS app against the LIVE stack (Supabase Cloud + PowerSync Cloud)
# and install it on a connected device.
#
# The dev stack stays the default everywhere else: plain `npm run ios` and
# `npm start` read .env and talk to 127.0.0.1, exactly as before.
#
# Why the values are read out of eas.json rather than written here too: the
# Android APK gets them from eas.json's `live` profile, and two hand-maintained
# copies of a server address is precisely the kind of drift that produces an
# iPad and a phone quietly syncing against different backends. One source of
# truth, read by both paths.
#
# Why not a .env.production file: Expo's own docs warn against switching
# environments on NODE_ENV, because `expo export` forces NODE_ENV=production
# regardless of what you meant. Variables exported into the process win over
# .env under standard dotenv resolution, which makes this both simpler and
# harder to get wrong.
#
# Usage: npm run ios:live

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

eval "$(node -e '
  const profile = require("./eas.json").build.live;
  if (!profile || !profile.env) {
    console.error("no live profile env in eas.json");
    process.exit(1);
  }
  for (const [k, v] of Object.entries(profile.env)) {
    console.log(`export ${k}=${JSON.stringify(v)}`);
  }
')"

echo "Building against:"
echo "  Supabase   $EXPO_PUBLIC_SUPABASE_URL"
echo "  PowerSync  $EXPO_PUBLIC_POWERSYNC_URL"
echo

# Release, not Debug: a Debug build fetches its JS from Metro at launch, so it
# only runs while this Mac is reachable. Release bundles the JS into the app,
# which is the entire point of putting it on a device you carry around.
exec npx expo run:ios --configuration Release --device "$@"
