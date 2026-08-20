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
HOST_TARGET="Dual Subtitle Companion (macOS)"
EXTENSION_TARGET="Dual Subtitle Companion Extension (macOS)"
EXPORT_OPTIONS="$SCRIPT_DIR/ExportOptions-DeveloperID.plist"
OUTPUT_DIR="$REPOSITORY_DIR/release"
EXPECTED_TEAM_ID="WX793X49GJ"
EXPECTED_HOST_BUNDLE_ID="com.sunny.dual-subtitle-companion"
EXPECTED_EXTENSION_BUNDLE_ID="com.sunny.dual-subtitle-companion.extension"
EXPECTED_DEPLOYMENT_TARGET="26.0"
SOURCE_MANIFEST="$REPOSITORY_DIR/Shared (Extension)/Resources/manifest.json"

fail() {
    echo "Release validation failed: $*" >&2
    exit 1
}

plist_value() {
    /usr/libexec/PlistBuddy -c "Print :$2" "$1"
}

build_setting() {
    local target="$1"
    local key="$2"

    xcodebuild \
        -project "$PROJECT_PATH" \
        -target "$target" \
        -configuration Release \
        -showBuildSettings \
        | awk -F ' = ' -v key="$key" '$1 ~ "^[[:space:]]*" key "$" && !found { value=$2; found=1 } END { if (found) print value }'
}

assert_equal() {
    local actual="$1"
    local expected="$2"
    local label="$3"

    [[ "$actual" == "$expected" ]] || fail "$label is '$actual'; expected '$expected'."
}

assert_universal_binary() {
    local executable="$1"
    local label="$2"
    local architectures

    architectures="$(lipo -archs "$executable")"
    [[ " $architectures " == *" arm64 "* ]] || fail "$label does not contain arm64: $architectures"
    [[ " $architectures " == *" x86_64 "* ]] || fail "$label does not contain x86_64: $architectures"
}

submit_for_notarization() {
    local submission_path="$1"
    local result_path="$2"
    local label="$3"
    local notary_status

    if ! xcrun notarytool submit "$submission_path" \
        --keychain-profile "$NOTARY_PROFILE" \
        --wait \
        --output-format json > "$result_path"; then
        [[ -s "$result_path" ]] && /bin/cat "$result_path" >&2
        fail "$label notarization submission failed."
    fi

    /bin/cat "$result_path"
    notary_status="$(plutil -extract status raw -o - "$result_path")"
    assert_equal "$notary_status" "Accepted" "$label notarization status"
}

verify_app() {
    local app_path="$1"
    local run_policy_checks="$2"
    local extension_path="$app_path/Contents/PlugIns/Dual Subtitle Companion Extension.appex"
    local manifest_path="$extension_path/Contents/Resources/manifest.json"
    local host_executable
    local extension_executable
    local forbidden_files
    local resource
    local host_signing_details
    local extension_signing_details

    [[ -d "$app_path" ]] || fail "Expected app is missing: $app_path"
    [[ -d "$extension_path" ]] || fail "Embedded extension is missing: $extension_path"
    [[ -f "$manifest_path" ]] || fail "Bundled manifest is missing: $manifest_path"

    codesign --verify --deep --strict --all-architectures --verbose=2 "$app_path"
    codesign --verify --strict --all-architectures --verbose=2 "$extension_path"

    assert_equal "$(plist_value "$app_path/Contents/Info.plist" CFBundleIdentifier)" "$EXPECTED_HOST_BUNDLE_ID" "Host bundle identifier"
    assert_equal "$(plist_value "$extension_path/Contents/Info.plist" CFBundleIdentifier)" "$EXPECTED_EXTENSION_BUNDLE_ID" "Extension bundle identifier"
    assert_equal "$(plist_value "$app_path/Contents/Info.plist" CFBundleShortVersionString)" "$VERSION" "Host version"
    assert_equal "$(plist_value "$extension_path/Contents/Info.plist" CFBundleShortVersionString)" "$VERSION" "Extension version"
    assert_equal "$(plist_value "$app_path/Contents/Info.plist" CFBundleVersion)" "$BUILD_NUMBER" "Host build number"
    assert_equal "$(plist_value "$extension_path/Contents/Info.plist" CFBundleVersion)" "$BUILD_NUMBER" "Extension build number"
    assert_equal "$(plutil -extract version raw -o - "$manifest_path")" "$VERSION" "Bundled manifest version"

    host_signing_details="$(codesign -dvvv "$app_path" 2>&1)"
    extension_signing_details="$(codesign -dvvv "$extension_path" 2>&1)"
    assert_equal "$(print -r -- "$host_signing_details" | awk -F= '/^TeamIdentifier=/ { print $2; exit }')" "$EXPECTED_TEAM_ID" "Host signing team"
    assert_equal "$(print -r -- "$extension_signing_details" | awk -F= '/^TeamIdentifier=/ { print $2; exit }')" "$EXPECTED_TEAM_ID" "Extension signing team"
    [[ "$host_signing_details" == *"Authority=Developer ID Application:"* ]] || fail "Host is not signed with a Developer ID Application certificate."
    [[ "$extension_signing_details" == *"Authority=Developer ID Application:"* ]] || fail "Extension is not signed with a Developer ID Application certificate."
    [[ "$host_signing_details" == *$'\nTimestamp='* ]] || fail "Host signature has no secure timestamp."
    [[ "$extension_signing_details" == *$'\nTimestamp='* ]] || fail "Extension signature has no secure timestamp."

    host_executable="$app_path/Contents/MacOS/$(plist_value "$app_path/Contents/Info.plist" CFBundleExecutable)"
    extension_executable="$extension_path/Contents/MacOS/$(plist_value "$extension_path/Contents/Info.plist" CFBundleExecutable)"
    assert_universal_binary "$host_executable" "Host executable"
    assert_universal_binary "$extension_executable" "Extension executable"

    for resource in \
        background.js \
        bootstrap.js \
        content.js \
        page-bridge.js \
        playback-player.js \
        popup.js \
        subtitle-detector.js \
        subtitle-parser.js \
        subtitle-renderer.js; do
        [[ -f "$extension_path/Contents/Resources/$resource" ]] || fail "Bundled extension resource is missing: $resource"
    done

    forbidden_files="$(find "$app_path" -type f \( \
        -iname '*.srt' -o -iname '*.vtt' -o -iname '*.webvtt' -o \
        -iname '*.ttml' -o -iname '*.dfxp' -o -iname '*.har' -o \
        -iname '*.pcap' -o -iname '*.pcapng' -o -iname '*.p12' -o \
        -iname '*.cer' -o -iname '*.key' -o -iname '.env' -o -iname '.env.*' \
    \) -print)"
    [[ -z "$forbidden_files" ]] || fail "Forbidden release files were found:\n$forbidden_files"

    if [[ "$run_policy_checks" == "yes" ]]; then
        xcrun stapler validate "$app_path"
        syspolicy_check distribution "$app_path" --verbose
        spctl --assess --type execute --verbose=2 "$app_path"
    fi
}

DEVELOPER_ID_IDENTITY="$(security find-identity -v -p codesigning \
    | awk -F '"' '/Developer ID Application:.*\(WX793X49GJ\)/ { print $2; exit }')"
if [[ -z "$DEVELOPER_ID_IDENTITY" ]]; then
    fail "No Developer ID Application identity for team $EXPECTED_TEAM_ID is installed."
fi

HOST_VERSION="$(build_setting "$HOST_TARGET" MARKETING_VERSION)"
EXTENSION_VERSION="$(build_setting "$EXTENSION_TARGET" MARKETING_VERSION)"
HOST_BUILD_NUMBER="$(build_setting "$HOST_TARGET" CURRENT_PROJECT_VERSION)"
EXTENSION_BUILD_NUMBER="$(build_setting "$EXTENSION_TARGET" CURRENT_PROJECT_VERSION)"
HOST_DEPLOYMENT_TARGET="$(build_setting "$HOST_TARGET" MACOSX_DEPLOYMENT_TARGET)"
EXTENSION_DEPLOYMENT_TARGET="$(build_setting "$EXTENSION_TARGET" MACOSX_DEPLOYMENT_TARGET)"
HOST_BUNDLE_ID="$(build_setting "$HOST_TARGET" PRODUCT_BUNDLE_IDENTIFIER)"
EXTENSION_BUNDLE_ID="$(build_setting "$EXTENSION_TARGET" PRODUCT_BUNDLE_IDENTIFIER)"
MANIFEST_VERSION="$(plutil -extract version raw -o - "$SOURCE_MANIFEST")"

[[ "$HOST_VERSION" == <->(|.<->)(|.<->)(|.<->) ]] || fail "Invalid host marketing version: $HOST_VERSION"
assert_equal "$EXTENSION_VERSION" "$HOST_VERSION" "Extension marketing version"
assert_equal "$MANIFEST_VERSION" "$HOST_VERSION" "Source manifest version"
assert_equal "$EXTENSION_BUILD_NUMBER" "$HOST_BUILD_NUMBER" "Extension build number"
assert_equal "$HOST_DEPLOYMENT_TARGET" "$EXPECTED_DEPLOYMENT_TARGET" "Host deployment target"
assert_equal "$EXTENSION_DEPLOYMENT_TARGET" "$EXPECTED_DEPLOYMENT_TARGET" "Extension deployment target"
assert_equal "$HOST_BUNDLE_ID" "$EXPECTED_HOST_BUNDLE_ID" "Host build-setting bundle identifier"
assert_equal "$EXTENSION_BUNDLE_ID" "$EXPECTED_EXTENSION_BUNDLE_ID" "Extension build-setting bundle identifier"

VERSION="$HOST_VERSION"
BUILD_NUMBER="$HOST_BUILD_NUMBER"
mkdir -p "$OUTPUT_DIR"
DMG_PATH="$OUTPUT_DIR/Dual-Subtitle-Companion-${VERSION}.dmg"
SHA_PATH="$DMG_PATH.sha256"
if [[ -e "$DMG_PATH" || -e "$SHA_PATH" ]]; then
    fail "Refusing to overwrite an existing v$VERSION release artifact."
fi

WORK_DIR="$(mktemp -d "${TMPDIR%/}/dual-subtitle-release.XXXXXX")"
MOUNTED=0
MOUNT_DIR="$WORK_DIR/mount"
cleanup() {
    if [[ "$MOUNTED" -eq 1 ]]; then
        hdiutil detach "$MOUNT_DIR" >/dev/null || true
    fi
    case "$WORK_DIR" in
        "${TMPDIR%/}"/dual-subtitle-release.*) rm -rf -- "$WORK_DIR" ;;
        *) echo "Skipped cleanup of unexpected temporary path: $WORK_DIR" >&2 ;;
    esac
}
trap cleanup EXIT

ARCHIVE_PATH="$WORK_DIR/Dual Subtitle Companion.xcarchive"
EXPORT_DIR="$WORK_DIR/export"
STAGING_DIR="$WORK_DIR/dmg-root"
APP_ZIP_PATH="$WORK_DIR/Dual-Subtitle-Companion-${VERSION}.zip"
APP_NOTARY_RESULT="$WORK_DIR/app-notary-result.json"
DMG_NOTARY_RESULT="$WORK_DIR/dmg-notary-result.json"

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
verify_app "$APP_PATH" no

ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP_PATH"
submit_for_notarization "$APP_ZIP_PATH" "$APP_NOTARY_RESULT" "App"
xcrun stapler staple "$APP_PATH"
verify_app "$APP_PATH" yes

mkdir -p "$STAGING_DIR"
ditto "$APP_PATH" "$STAGING_DIR/Dual Subtitle Companion.app"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
    -volname "Dual Subtitle Companion" \
    -srcfolder "$STAGING_DIR" \
    -format UDZO \
    "$DMG_PATH"

codesign --force --sign "$DEVELOPER_ID_IDENTITY" --timestamp "$DMG_PATH"
codesign --verify --strict --verbose=2 "$DMG_PATH"
DMG_SIGNING_DETAILS="$(codesign -dvvv "$DMG_PATH" 2>&1)"
assert_equal "$(print -r -- "$DMG_SIGNING_DETAILS" | awk -F= '/^TeamIdentifier=/ { print $2; exit }')" "$EXPECTED_TEAM_ID" "DMG signing team"
[[ "$DMG_SIGNING_DETAILS" == *"Authority=Developer ID Application:"* ]] || fail "DMG is not signed with a Developer ID Application certificate."
[[ "$DMG_SIGNING_DETAILS" == *$'\nTimestamp='* ]] || fail "DMG signature has no secure timestamp."

submit_for_notarization "$DMG_PATH" "$DMG_NOTARY_RESULT" "DMG"
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
codesign --verify --strict --verbose=2 "$DMG_PATH"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH"

mkdir -p "$MOUNT_DIR"
hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_DIR"
MOUNTED=1
verify_app "$MOUNT_DIR/Dual Subtitle Companion.app" yes
hdiutil detach "$MOUNT_DIR"
MOUNTED=0

shasum -a 256 "$DMG_PATH" > "$SHA_PATH"
/bin/cat "$SHA_PATH"

echo "Signed and notarized release created at: $DMG_PATH"
