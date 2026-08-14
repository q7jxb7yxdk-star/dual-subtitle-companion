# Dual Subtitle Companion

Dual Subtitle Companion is an independent macOS Safari Web Extension proof of concept. On supported Netflix playback pages, it attempts to display the official English and Traditional Chinese subtitle tracks together.

> [!IMPORTANT]
> This is unofficial research software. It is not affiliated with, endorsed by, sponsored by, or approved by Netflix. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before using or redistributing the project.

## Current status

The POC has demonstrated the complete technical path in a macOS Safari test environment:

- Injection on `https://www.netflix.com/watch/*`.
- Discovery of the active HTML `<video>` element.
- Discovery of timed-text track metadata through the page's player context.
- In-memory capture and parsing of official English and Traditional Chinese timed text.
- Synchronized bilingual rendering based on `video.currentTime`.
- Temporary suspension of the site's native subtitle track while bilingual rendering is enabled.
- Restoration of the previously selected native subtitle track when bilingual rendering is disabled.
- Reparenting of the subtitle overlay for webpage-container fullscreen playback.

Availability is title-, profile-, account-, region-, and service-version-dependent. The project relies on an undocumented player implementation and can stop working without notice.

## Privacy and data handling

- Subtitle cues are processed in the playback page's memory and are not intentionally written to persistent storage.
- The extension stores only its enabled state, a revision number, and the identifier needed to restore the previously selected native subtitle track.
- The project contains no analytics, advertising SDK, translation service, or project-operated backend.
- It does not provide subtitle download or export features.
- Query strings are not retained by the user interface.

Do not commit subtitle files, captured network responses, account data, cookies, tokens, or service content to this repository. `.gitignore` blocks common capture and subtitle formats as an additional safeguard.

Read the complete [Privacy Policy](PRIVACY_POLICY.md). The public App Store Privacy Policy URL can point to:

```text
https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/blob/main/PRIVACY_POLICY.md
```

## Support

Report reproducible problems through [GitHub Issues](https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/issues). Include the macOS and Safari versions, whether both required subtitle tracks are available, and the action that failed.

Do not include account credentials, cookies, tokens, subtitle text, screenshots containing private account information, HAR files, captured responses, or copyrighted media in an issue.

## Requirements

- macOS 13 or later with a current Safari version
- Xcode
- A valid subscription and account for the supported service
- A title that offers both English and Traditional Chinese subtitles

The repository contains iOS template targets, but the POC is currently supported and validated only on macOS Safari.

## Build and run

Clone the source repository:

```sh
git clone https://github.com/q7jxb7yxdk-star/dual-subtitle-companion.git
cd dual-subtitle-companion
```

Then:

1. Open `Dual Subtitle Companion.xcodeproj` in Xcode.
2. Select the **Dual Subtitle Companion (macOS)** scheme.
3. Select the standard **My Mac** destination.
4. Run the containing app.
5. Open **Safari → Settings → Extensions**.
6. Enable **Dual Subtitle Companion** and grant access to `netflix.com`.
7. Reload an existing playback tab after rebuilding the extension.

## Direct installation

When a signed release is available, download the DMG from the repository's
[Releases](https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/releases) page:

1. Open `Dual-Subtitle-Companion-<version>.dmg`.
2. Drag **Dual Subtitle Companion** to **Applications**.
3. Open the app once, then choose **Open Safari Extension Settings**.
4. Enable the extension and grant access to `netflix.com`.

Only install a release published by this repository. A normal direct-install
release must be signed with the maintainer's Developer ID and notarized by
Apple. Source snapshots and artifacts uploaded by third parties are not
official installable builds. Releases do not update automatically; replace the
app in Applications when a newer signed release is published.

## Usage

1. Open a supported playback page.
2. Click the Dual Subtitle Companion button in the Safari toolbar.
3. Enable **啟用雙語字幕**.
4. Disable it to hide the bilingual overlay and restore the previous site subtitle track.

Initial activation may take several seconds while the extension waits for the active player session and both timed-text resources.

## Subtitle presentation

Both languages use the same responsive size:

```css
clamp(20px, 2.35vw, 36px)
```

- English: white
- Traditional Chinese: warm yellow
- Weight: 600
- Minimum: 20px
- Maximum: 36px

The overlay follows webpage-container fullscreen mode. Safari's native `<video>` fullscreen presentation doesn't permit a regular webpage DOM overlay.

## Project structure

```text
Shared (Extension)/Resources/
├── manifest.json
├── content.js
├── content.css
├── playback-player.js
├── page-bridge.js
├── subtitle-detector.js
├── subtitle-parser.js
├── subtitle-renderer.js
└── popup.html / popup.js / popup.css
```

See [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md) for implementation details.

## Non-goals

The project does not:

- Translate subtitles.
- Use AI or third-party translation services.
- Download or redistribute subtitle files.
- Download, process, or decrypt video or audio.
- Bypass DRM or decrypt MSL envelopes.
- Include service credentials or a review/demo account.
- Commit signed applications or binaries to the Git repository.

## Known limitations

- The player API and object paths are undocumented and unstable.
- Track availability differs by title, episode, account language, profile, and region.
- Timed-text discovery depends on player switching, cache behavior, and network timing.
- Single-page navigation can replace the active player session.
- Native Safari video fullscreen cannot display a custom DOM overlay.

## Distribution

The canonical source repository is [q7jxb7yxdk-star/dual-subtitle-companion](https://github.com/q7jxb7yxdk-star/dual-subtitle-companion).

The Git repository contains source code only. The maintainer may separately publish Developer ID-signed and Apple-notarized DMG files on GitHub Releases. Release artifacts are not covered by Git history and must never contain subtitle data, captured service responses, credentials, or account information. Contributors must not attach unapproved compiled applications or third-party content to releases, issues, or pull requests.

Publishing source code under the MIT License does not grant rights to any third-party service, trademark, subtitle track, media, or private interface. Users and distributors remain responsible for compliance with applicable service terms and laws.

## License

Original project code and original assets are available under the [MIT License](LICENSE). Third-party rights are expressly excluded; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Use and data handling are also subject to the [Privacy Policy](PRIVACY_POLICY.md).
