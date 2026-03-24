#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
PROJECT_PATH="$ROOT_DIR/apps/native-macos/LoopBrowserNative.xcodeproj"
DERIVED_DATA_PATH="$ROOT_DIR/output/native/TestDerivedDataStress-$STAMP"
RESULT_BUNDLE_PATH="$ROOT_DIR/output/native/TestResultsStress-$STAMP.xcresult"
LOG_PATH="$ROOT_DIR/output/native/native-stress-tests-$STAMP.log"

mkdir -p "$ROOT_DIR/output/native"

echo "Running native stress tests with live UI output..."
echo "DERIVED_DATA_PATH=$DERIVED_DATA_PATH"
echo "RESULT_BUNDLE_PATH=$RESULT_BUNDLE_PATH"
echo "LOG_PATH=$LOG_PATH"

HOME=/tmp xcodebuild test \
  -project "$PROJECT_PATH" \
  -scheme LoopBrowserNative \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -destination "platform=macOS,arch=arm64" \
  -only-testing:LoopBrowserNativeUITests/LoopBrowserNativeUITests/testViewportInputFocusCanReturnToCanvasAndMoveViewport \
  -only-testing:LoopBrowserNativeUITests/LoopBrowserNativeUITests/testCompositeCanvasWorkflowRemainsInteractive | tee "$LOG_PATH"

echo "Completed native stress tests."
