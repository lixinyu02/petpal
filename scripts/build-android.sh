#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK with API 36}"
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21}"
npm run build
npx --no-install cap sync android
(cd android && bash ./gradlew --no-daemon assembleDebug)
mkdir -p releases/android
version="$(node -p "require('./package.json').version")"
cp android/app/build/outputs/apk/debug/app-debug.apk "releases/android/PetPal-${version}-Android-debug.apk"
sha256sum "releases/android/PetPal-${version}-Android-debug.apk"
