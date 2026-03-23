#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_PATH="$ROOT_DIR/apps/native-macos/LoopBrowserNative.xcodeproj"
DERIVED_DATA_PATH="$ROOT_DIR/output/native/DerivedData"
BUILD_OUTPUT_PATH="$DERIVED_DATA_PATH/Build/Products/Release"
APP_PATH="$BUILD_OUTPUT_PATH/LoopBrowserNative.app"
HANDOFF_APP_PATH="$ROOT_DIR/output/Loop Browser.app"
HANDOFF_ZIP_PATH="$ROOT_DIR/output/Loop Browser-macOS.zip"
SUPPORT_PACKAGE_PATH="$ROOT_DIR/apps/native-macos/LoopBrowserNativeSupport"

mkdir -p "$ROOT_DIR/output/native" "$ROOT_DIR/output"
rm -rf "$DERIVED_DATA_PATH" "$HANDOFF_APP_PATH" "$HANDOFF_ZIP_PATH"

(
  cd "$SUPPORT_PACKAGE_PATH"
  HOME=/tmp SWIFTPM_ENABLE_PLUGIN_LOADING=0 CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache swift test
)

HOME=/tmp xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme LoopBrowserNative \
  -destination "platform=macOS,arch=arm64" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_ALLOWED=YES \
  test

HOME=/tmp xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme LoopBrowserNative \
  -configuration Release \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_ALLOWED=YES \
  build

/usr/bin/ditto "$APP_PATH" "$HANDOFF_APP_PATH"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$HANDOFF_APP_PATH" "$HANDOFF_ZIP_PATH"

echo "APP_PATH=$HANDOFF_APP_PATH"
echo "ZIP_PATH=$HANDOFF_ZIP_PATH"
