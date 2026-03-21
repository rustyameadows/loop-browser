#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_PATH="$ROOT_DIR/apps/native-macos/LoopBrowserNative.xcodeproj"
DERIVED_DATA_PATH="$ROOT_DIR/output/native/DerivedData"
BUILD_OUTPUT_PATH="$DERIVED_DATA_PATH/Build/Products/Release"
APP_PATH="$BUILD_OUTPUT_PATH/LoopBrowserNative.app"
ZIP_PATH="$ROOT_DIR/output/native/LoopBrowserNative-macos.zip"

mkdir -p "$ROOT_DIR/output/native"
rm -rf "$DERIVED_DATA_PATH" "$ZIP_PATH"

HOME=/tmp xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme LoopBrowserNative \
  -configuration Release \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  build

/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

echo "APP_PATH=$APP_PATH"
echo "ZIP_PATH=$ZIP_PATH"
