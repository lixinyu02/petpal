#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK with API 36}"
if [[ -n "${PETPAL_ANDROID_JDK:-}" ]]; then
  export JAVA_HOME="$PETPAL_ANDROID_JDK"
elif [[ -x "$PWD/.tools/jdk-21/bin/javac" ]]; then
  export JAVA_HOME="$PWD/.tools/jdk-21"
fi
: "${JAVA_HOME:?Set JAVA_HOME or PETPAL_ANDROID_JDK to JDK 21}"
[[ -x "$JAVA_HOME/bin/java" && -x "$JAVA_HOME/bin/javac" && -f "$JAVA_HOME/release" ]] || { echo 'Set JAVA_HOME or PETPAL_ANDROID_JDK to a JDK 21 installation.' >&2; exit 1; }
java_major=''
while IFS= read -r line; do
  if [[ "$line" =~ ^JAVA_VERSION=\"([0-9]+) ]]; then java_major="${BASH_REMATCH[1]}"; break; fi
done < "$JAVA_HOME/release"
[[ "$java_major" == '21' ]] || { echo 'Android requires JDK 21; older JAVA_HOME values are not supported.' >&2; exit 1; }
export PATH="$JAVA_HOME/bin:$PATH"
printf 'Android build uses JDK 21: %s\n' "$JAVA_HOME"
if [[ -n "${PETPAL_ANDROID_GRADLE:-}" ]]; then
  gradle_path="$PETPAL_ANDROID_GRADLE"
elif [[ -f "$PWD/.tools/gradle-8.11.1/bin/gradle" ]]; then
  gradle_path="$PWD/.tools/gradle-8.11.1/bin/gradle"
else
  gradle_path="$PWD/android/gradlew"
fi
version="$(node --input-type=module -e 'import fs from "node:fs"; const v=fs.readFileSync("android/app/build.gradle","utf8").match(/versionName\s+"([0-9]+\.[0-9]+\.[0-9]+)"/); if(!v)throw Error("Invalid Android versionName"); console.log(v[1]);')"
export PETPAL_ANDROID_WEB_DIR="${PETPAL_ANDROID_WEB_DIR:-$PWD/.data/android-web-build}"
export PETPAL_ANDROID_VERSION="$version"
npm run build -- --outDir "$PETPAL_ANDROID_WEB_DIR"
npx --no-install cap sync android
(cd android && bash "$gradle_path" --no-daemon --console plain assembleDebug)
mkdir -p releases/android
target="releases/android/PetPal-${version}-Android-debug.apk"
if [ -e "$target" ]; then
  cmp android/app/build/outputs/apk/debug/app-debug.apk "$target" || { echo 'Existing APK differs; use a new version.' >&2; exit 1; }
else
  cp android/app/build/outputs/apk/debug/app-debug.apk "$target"
fi
sha256sum "releases/android/PetPal-${version}-Android-debug.apk"
