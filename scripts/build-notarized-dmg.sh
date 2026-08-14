#!/bin/zsh

set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
    echo "Usage: $0 <notarytool-keychain-profile>" >&2
    exit 64
fi

NOTARY_PROFILE="$1"
SCRIPT_DIR="${0:A:h}"
REPOSITORY_DIR="${SCRIPT_DIR:h}"
PROJECT_PATH="$REPOSITORY_DIR/Dual Subtitle Companion.xcodeproj"
SCHEME="Dual Subtitle Companion (macOS)"
EXPORT_OPTIONS="$SCRIPT_DIR/ExportOptions-DeveloperID.plist"
OUTPUT_DIR="$REPOSITORY_DIR/release"

if ! security find-identity -v -p codesigning | grep -q '"Developer ID Application:'; then
    echo "No Developer ID Application signing identity is installed in the keychain." >&2
    exit 69
fi

VERSION="$(xcodebuild -project "$PROJECT_PATH" -scheme "$SCHEME" -configuration Release -showBuildSettings | awk '/MARKETING_VERSION =/ { print $3; exit }')"
if [[ -z "$VERSION" ]]; then
    echo "Unable to read MARKETING_VERSION from the Xcode project." >&2
    exit 65
fi

mkdir -p "$OUTPUT_DIR"
DMG_PATH="$OUTPUT_DIR/Dual-Subtitle-Companion-${VERSION}.dmg"
if [[ -e "$DMG_PATH" ]]; then
    echo "Refusing to overwrite existing artifact: $DMG_PATH" >&2
    exit 73
fi

WORK_DIR="$(mktemp -d "${TMPDIR%/}/dual-subtitle-release.XXXXXX")"
cleanup() {
    case "$WORK_DIR" in
        "${TMPDIR%/}"/dual-subtitle-release.*) rm -rf -- "$WORK_DIR" ;;
        *) echo "Skipped cleanup of unexpected temporary path: $WORK_DIR" >&2 ;;
    esac
}
trap cleanup EXIT

ARCHIVE_PATH="$WORK_DIR/Dual Subtitle Companion.xcarchive"
EXPORT_DIR="$WORK_DIR/export"
STAGING_DIR="$WORK_DIR/dmg-root"

xcodebuild archive \
    -project "$PROJECT_PATH" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "generic/platform=macOS" \
    -archivePath "$ARCHIVE_PATH"

xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$EXPORT_OPTIONS"

APP_PATH="$EXPORT_DIR/Dual Subtitle Companion.app"
if [[ ! -d "$APP_PATH" ]]; then
    echo "Export did not produce the expected app: $APP_PATH" >&2
    exit 66
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

mkdir -p "$STAGING_DIR"
ditto "$APP_PATH" "$STAGING_DIR/Dual Subtitle Companion.app"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
    -volname "Dual Subtitle Companion" \
    -srcfolder "$STAGING_DIR" \
    -format UDZO \
    "$DMG_PATH"

xcrun notarytool submit "$DMG_PATH" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait

xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
spctl --assess --type execute --verbose=2 "$APP_PATH"
shasum -a 256 "$DMG_PATH"

echo "Notarized release created at: $DMG_PATH"
