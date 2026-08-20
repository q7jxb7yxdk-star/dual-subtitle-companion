# Dual Subtitle Companion

Dual Subtitle Companion is an independent macOS Safari Web Extension proof of concept. On supported Netflix playback pages, it attempts to obtain the official English and Traditional Chinese timed-text tracks already delivered to the browser and display them together.

The project does not translate subtitles, download media, bypass DRM, or provide subtitle export. It exists to validate bilingual subtitle acquisition and synchronized rendering in Safari.

> [!IMPORTANT]
> This is unofficial research software. It is not affiliated with, endorsed by, sponsored by, or approved by Netflix, Inc. Availability depends on the title, account, profile, region, and the current website player implementation. Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before using or redistributing the project.

## Features

- Runs a lightweight route bootstrap only on `https://www.netflix.com/*`; player and subtitle modules activate only on `https://www.netflix.com/watch/*`.
- Locates the active HTML `<video>` element and uses `video.currentTime` for synchronization.
- Discovers timed-text metadata from HTML text tracks and the playback page's player context.
- Captures and parses official English and Traditional Chinese timed text in memory.
- Supports WebVTT, TTML/DFXP, and known JSON-like cue structures.
- Renders two subtitle lines with the same responsive font size.
- Temporarily selects the site's None subtitle track while bilingual rendering is active.
- Restores the previously selected native subtitle track when bilingual mode is disabled.
- Follows webpage-container fullscreen by moving the overlay into the fullscreen element.
- Automatically activates playback-page scripts after Netflix single-page navigation, with the Safari toolbar toggle retained as an on-demand fallback.
- Provides a containing app with setup, privacy, support, and third-party-notice links.

There is no production debug panel, options page, analytics service, translation service, or project-operated backend. The Manifest V3 background service worker is nonpersistent and only coordinates validated Netflix playback-page injection.

## Requirements

### To use the extension

- macOS 26.0 or later.
- Safari with the extension enabled and access granted to `netflix.com`.
- A valid account and subscription for the supported service.
- A title that offers both English and Traditional Chinese subtitles.

The project is supported and validated only on macOS Safari.

### To build from source

- A recent Xcode capable of opening the project. The current source was verified with Xcode 26.6 and the macOS 26.5 SDK; older Xcode versions have not been verified.
- The bundled Apple Swift toolchain. No separate Swift installation is required.
- Node.js only if you want to run the optional JavaScript syntax checks. The project does not pin a Node.js version and does not require Node.js at runtime.

There are no npm packages, Swift Packages, CocoaPods, Python packages, environment variables, API keys, or third-party code dependencies required to build and run the project.

## Installation and setup

### Install a signed release

The latest published binary is available from [GitHub Releases](https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/releases). Release `v1.1.2` is distributed as a Developer ID-signed and Apple-notarized Universal DMG.

1. Download `Dual-Subtitle-Companion-<version>.dmg`.
2. Open the DMG and drag **Dual Subtitle Companion** to **Applications**.
3. Open the app once and choose **Quit and Open Safari Settings…**.
4. Enable **Dual Subtitle Companion** in Safari Extensions.
5. Grant access to `netflix.com`.

Releases do not update automatically. Install a newer version by replacing the app in Applications.

### Build from source

```sh
git clone https://github.com/q7jxb7yxdk-star/dual-subtitle-companion.git
cd dual-subtitle-companion
open "Dual Subtitle Companion.xcodeproj"
```

No dependency-installation step is required.

## How to run

1. In Xcode, select the **Dual Subtitle Companion (macOS)** scheme.
2. Select the standard **My Mac** destination, not a Designed for iPad destination.
3. Run the containing app.
4. Enable the extension in **Safari → Settings → Extensions** and allow `netflix.com` access.
5. Reload an existing Netflix playback tab after rebuilding the extension.
6. Click the extension button in the Safari toolbar.
7. Enable **啟用雙語字幕**.

Initial activation may take several seconds while the extension waits for a player session, switches through both required tracks, and observes the timed-text responses. Disabling bilingual mode hides the overlay and attempts to restore the previous native subtitle track.

## Project structure

```text
Dual Subtitle Companion.xcodeproj/       Xcode project and macOS targets
Shared (App)/                            Containing-app controller, help UI, and assets
macOS (App)/                             macOS app delegate and storyboard
Shared (Extension)/                      Safari extension handler and web resources
  Resources/
    manifest.json                        Manifest V3 configuration
    bootstrap.js                         Lightweight Netflix playback-route detector
    background.js                        Validated, nonpersistent injection coordinator
    content.js                           Isolated-world controller and state coordination
    page-bridge.js                       Page-context player and network adapter
    playback-player.js                   Video and HTML text-track probe
    subtitle-detector.js                 Track normalization and language selection
    subtitle-parser.js                   WebVTT, TTML/DFXP, and JSON cue parsing
    subtitle-renderer.js                 Time-synchronized bilingual overlay
    popup.html / popup.js / popup.css    Safari toolbar toggle
macOS (Extension)/                       Safari Web Extension Info.plist
scripts/                                 Developer ID export and release tooling
```

See [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md) for the architecture, data flow, state model, and maintenance notes.

## Development

List the current targets and scheme:

```sh
xcodebuild -project "Dual Subtitle Companion.xcodeproj" -list
```

Build without distribution signing:

```sh
xcodebuild \
  -project "Dual Subtitle Companion.xcodeproj" \
  -scheme "Dual Subtitle Companion (macOS)" \
  -configuration Debug \
  -sdk macosx \
  CODE_SIGNING_ALLOWED=NO \
  build

xcodebuild \
  -project "Dual Subtitle Companion.xcodeproj" \
  -scheme "Dual Subtitle Companion (macOS)" \
  -configuration Release \
  -sdk macosx \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Optional JavaScript syntax checks:

```sh
for file in "Shared (Extension)/Resources/"*.js; do
  node --check "$file"
done

node --check "Shared (App)/Resources/Script.js"
```

The repository has no configured formatter, linter, automated test target, or CI workflow. Runtime validation is manual and requires a supported playback title.

The `scripts/build-notarized-dmg.sh` workflow validates version and bundle metadata, creates a Developer ID archive, notarizes and staples the exported app, builds and Developer ID-signs the DMG from that stapled app, notarizes and staples the DMG, remounts it, and verifies the contained app before producing a SHA-256 checksum.

## Known limitations

- The player API and object paths are undocumented and can change without notice.
- Track availability varies by title, episode, profile, account language, and region.
- Timed-text capture depends on player switching, cache behavior, and network timing.
- A replacement player session can require a fresh enable cycle.
- Safari native `<video>` fullscreen cannot contain the custom webpage overlay; webpage-container fullscreen is supported.
- The toolbar has only an enable/disable control. There is no production diagnostics UI.
- There are no automated tests, and older Xcode versions have not been verified.
- GitHub releases require manual replacement of the installed app; there is no updater.

## Privacy and distribution

Subtitle cues and observed response bodies are processed in playback-page memory and are not intentionally persisted, exported, or sent to a project-operated service. Extension local storage contains only the enable state, a revision value, and the native subtitle track identifier used for restoration.

Do not submit subtitle text, captured responses, account data, cookies, tokens, HAR files, packet captures, or copyrighted media to the repository or GitHub Issues. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Original project code and original assets are licensed under the [MIT License](LICENSE). The license does not grant rights to any third-party service, private interface, trademark, media, or subtitle data.
