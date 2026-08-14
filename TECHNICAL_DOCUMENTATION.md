# Dual Subtitle Companion — Technical Documentation

## 1. Scope

Dual Subtitle Companion is a macOS Safari Web Extension proof of concept that attempts to render the English and Traditional Chinese timed-text tracks supplied by a supported playback page at the same time.

The implementation processes subtitle data in memory. It does not include subtitle downloads, translation, media processing, DRM bypass, MSL decryption, analytics, advertising, or a project-operated server.

## 2. Architecture

```text
Safari toolbar popup
        │ browser.storage + tabs message
        ▼
content.js (isolated world)
  ├── playback-player.js ─── DOM video and HTML textTracks
  ├── subtitle-detector.js ─ metadata normalization and language selection
  ├── subtitle-parser.js ─── WebVTT / TTML / JSON to normalized cues
  └── subtitle-renderer.js ─ video.currentTime to bilingual overlay
        │
        │ window.postMessage with source and origin checks
        ▼
page-bridge.js (page context)
  ├── page player session and timed-text track API
  ├── fetch / XMLHttpRequest observation
  └── Performance Resource Timing observation
```

Safari content scripts run in an isolated world. `page-bridge.js` is injected as a web-accessible resource because the player object exists in the page context. Messages are accepted only when they come from the same window and origin and carry the expected source identifier.

## 3. Manifest scope

The Manifest V3 extension uses the minimum site scope required by the POC:

- Content script: `https://www.netflix.com/watch/*`
- Host permission: `https://www.netflix.com/*`
- Extension permission: `storage`
- Injection time: `document_start`
- Frames: top frame only

The toolbar popup is the only public Extension UI. There is no production debug panel or options page.

## 4. Module responsibilities

### `content.js`

- Loads the enabled state and the previously selected native subtitle track ID.
- Injects the page-context bridge.
- Receives player metadata and timed-text candidates.
- Associates parsed cues with the controlled track capture.
- Sends English and Traditional Chinese cue collections to the renderer.
- Synchronizes toolbar state through direct tab messages and storage revisions.
- Requests native subtitle suspension and restoration.

### `playback-player.js`

- Locates `document.querySelector("video")`.
- Observes `video.textTracks` as a standards-based fallback.
- Reports the active video and track changes to the content controller.

### `page-bridge.js`

- Locates the current page player session.
- Enumerates timed-text tracks through available player methods.
- Selects tracks during the controlled capture sequence.
- Observes relevant `fetch` and `XMLHttpRequest` responses without consuming the original response.
- Ignores MSL envelopes and response bodies larger than 8 MiB.
- Suspends and restores the site's native timed-text track.

### `subtitle-detector.js`

- Merges tracks from player metadata, manifest-like JSON, resource URLs, and HTML text tracks.
- Normalizes language, label, track ID, format, and optional URL fields.
- Associates parsed cues with the track active during a controlled capture.

### `subtitle-parser.js`

Parses the observed formats into:

```js
{
  start: Number,
  end: Number,
  text: String
}
```

Supported inputs include WebVTT, TTML/DFXP, and known JSON-like cue trees. TTML parsing supports clock, frame, tick, duration, `frameRate`, and `tickRate` timing.

### `subtitle-renderer.js`

- Normalizes and sorts cue collections.
- Uses binary search to locate cues around `video.currentTime`.
- Handles overlapping cues.
- Uses `requestAnimationFrame` for playback synchronization.
- Updates DOM only when rendered text changes.
- Reparents the overlay into a webpage fullscreen element and returns it to the document root when fullscreen ends.

## 5. Player compatibility adapter

The current compatibility path locates the page's player API from `window.netflix.appContext.state.playerApp`. It then discovers a player session and tries available timed-text getters and setters.

This path is undocumented, unsupported, and expected to change. References to Netflix are compatibility identifiers only; they do not indicate affiliation or permission. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## 6. Language selection

English matching accepts `en` language tags and English labels.

Traditional Chinese matching accepts values such as:

```text
zh-Hant
zh-TW
zh-HK
zh-MO
Traditional Chinese
繁體 / 繁体
```

It explicitly rejects Simplified Chinese markers including `zh-Hans`, `zh-CN`, `zh-SG`, `Simplified`, `簡體`, and `简体`.

Track selection excludes None, forced-narrative, and image-based tracks. It prefers primary subtitle variants over closed-caption alternatives when possible.

## 7. Controlled dual-track capture

Most playback UIs select one subtitle track at a time. The POC therefore performs a controlled sequence:

```text
save the current native track
        ↓
select English and wait for timed text
        ↓
select Traditional Chinese and wait for timed text
        ↓
restore the original track
        ↓
when bilingual mode is active, select None and render the custom overlay
```

Each capture carries a sequence ID, language, and track ID. A capture is complete only when parsing yields at least one cue. The current timeouts are 12 seconds per subtitle response, 15 seconds for a player session, and 2.5 seconds for track-selection confirmation.

## 8. Network handling and boundaries

The bridge observes response bodies only in the active playback page. It supports text, JSON, ArrayBuffer, and Blob responses up to 8 MiB. It does not persist responses or expose a download/export interface.

MSL-like envelopes are detected and skipped. The project does not decrypt licenses, MSL payloads, video, or audio.

Repository policy prohibits committed subtitle files, HAR files, packet captures, response dumps, account data, cookies, and tokens. `.gitignore` contains defensive patterns, but contributors must still inspect staged changes before committing.

## 9. Native subtitle state machine

When bilingual mode is enabled:

1. The toolbar writes the enabled state and a monotonic revision.
2. A direct tab message applies the new state immediately.
3. The bridge saves the current native track ID before selecting the None track.
4. The renderer becomes visible after both cue collections are available.

When bilingual mode is disabled:

1. The renderer hides immediately.
2. The bridge waits for the current player session.
3. It restores the exact saved track ID where possible.
4. If the ID is unavailable in a replacement session, it falls back to Traditional Chinese, then English.

Storage and direct messages can arrive in different orders. `dualSubtitlesRevision` prevents an older asynchronous event from overriding the latest user action. Native subtitle operations are serialized with a promise chain.

## 10. Persistent storage

| Key | Type | Purpose |
| --- | --- | --- |
| `dualSubtitlesEnabled` | Boolean | Toolbar state |
| `dualSubtitlesRevision` | Number | State-ordering revision |
| `nativeSubtitleTrackId` | String | Track identifier used for restoration |

Full subtitle cues and captured response bodies are not intentionally written to extension storage.

## 11. Rendering and fullscreen

Both subtitle lines use:

```css
font-size: clamp(20px, 2.35vw, 36px);
font-weight: 600;
```

English is white and Traditional Chinese is warm yellow. The overlay has `pointer-events: none` and does not block playback controls.

Browsers display only the fullscreen element's subtree during webpage fullscreen. The renderer therefore reparents its existing overlay to the standard or WebKit fullscreen element. Safari native `<video>` fullscreen is a separate presentation layer and cannot contain a custom webpage DOM overlay.

## 12. Privacy and security considerations

- The extension requests access only to the supported service domain.
- It has no project-operated server or telemetry.
- Subtitle text remains in page memory unless the browser or website independently persists it.
- The extension stores only control state and one track identifier.
- Page messages validate window, origin, and source identifiers.
- Track-fetch URLs must use HTTPS and cannot point back to `/watch/` pages.
- Response size is capped before decoding.

The complete public policy is [PRIVACY_POLICY.md](PRIVACY_POLICY.md). The containing app exposes allowlisted buttons for the Privacy Policy, GitHub Issues, and Third-Party Notices. External URLs are opened by native platform APIs rather than allowing arbitrary WKWebView navigation.

The host app presents failures from `SFSafariExtensionManager` and `SFSafariApplication` in an `aria-live` error region. Web-to-native messages use a dictionary with an explicit action, and URL actions are rejected unless the complete URL matches the native allowlist.

## 13. Validation

Local validation should include:

```sh
node --check "Shared (Extension)/Resources/content.js"
node --check "Shared (Extension)/Resources/page-bridge.js"
node --check "Shared (Extension)/Resources/subtitle-detector.js"
node --check "Shared (Extension)/Resources/subtitle-parser.js"
node --check "Shared (Extension)/Resources/subtitle-renderer.js"
node --check "Shared (Extension)/Resources/playback-player.js"

xcodebuild \
  -project "Dual Subtitle Companion.xcodeproj" \
  -scheme "Dual Subtitle Companion (macOS)" \
  -configuration Release \
  -sdk macosx \
  CODE_SIGNING_ALLOWED=NO build
```

Runtime validation must cover enable, dual rendering, native subtitle suspension, disable, restoration, fullscreen entry/exit, route changes, and player-session replacement.

The macOS host and extension have a deployment target of macOS 13.0. Before a
direct-distribution release, install a valid `Developer ID Application`
identity and store notarization credentials in the login keychain using
`notarytool store-credentials`. Credentials and certificate exports must never
be placed in this repository.

The release script accepts only the keychain profile name:

```sh
./scripts/build-notarized-dmg.sh "dual-subtitle-notary"
```

It archives the Release scheme, exports with the `developer-id` method,
verifies the nested code signatures and Gatekeeper assessment, creates a DMG,
submits the DMG to Apple's notary service, staples and validates the ticket,
and prints its SHA-256 checksum. It refuses to overwrite an existing artifact.

## 14. Distribution policy

The canonical source repository is:

```text
https://github.com/q7jxb7yxdk-star/dual-subtitle-companion
```

The Git repository contains source code only. The maintainer may publish a Developer ID-signed and Apple-notarized DMG through GitHub Releases. Archives, exported applications, certificates, credentials, subtitle data, and captured service responses must not be committed. Contributors must not attach unapproved binaries or third-party content to GitHub Releases, issues, or pull requests.

The MIT License covers only original project code and original project assets. It does not grant rights to any third-party service, interface, content, subtitle track, or trademark.

Public project endpoints:

- Privacy Policy: `https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/blob/main/PRIVACY_POLICY.md`
- Support: `https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/issues`
- Third-Party Notices: `https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/blob/main/THIRD_PARTY_NOTICES.md`
