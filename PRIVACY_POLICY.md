# Privacy Policy

Last updated: August 14, 2026

Dual Subtitle Companion is an independent Safari Web Extension that processes subtitle information locally in the user's browser. This policy explains what the extension can access, what remains on the device, and the controls available to the user.

## Data we collect

The developer does not collect, receive, sell, rent, or share personal data through Dual Subtitle Companion. The project has no analytics, advertising SDK, telemetry service, project-operated server, or user account system.

## Data processed on the device

When the user grants website access and enables bilingual subtitles, the extension may process the following information inside the active playback page:

- The current page URL and playback-page state.
- The active video element and its current playback time.
- Subtitle-track metadata, including language labels and track identifiers.
- English and Traditional Chinese timed-text cues supplied to the user's browser by the supported service.
- The current native subtitle selection, so it can be restored later.

Timed-text cues and observed response bodies are processed in memory for subtitle rendering. The extension does not intentionally save, export, upload, or transmit this content to the developer or to a project-operated service.

The third-party website continues to receive its normal browser requests independently of this extension. The website's own collection and processing practices are governed by its privacy policy and terms, not by this policy.

## Data stored locally

The extension uses Safari extension local storage for these settings:

| Key | Purpose |
| --- | --- |
| `dualSubtitlesEnabled` | Remembers whether bilingual subtitles are enabled. |
| `dualSubtitlesRevision` | Prevents an older state update from replacing the user's latest choice. |
| `nativeSubtitleTrackId` | Restores the subtitle track selected before bilingual mode was enabled. |

These values remain on the device until Safari clears the extension's data or the user removes the extension. They are not synchronized to or stored on a server operated by this project.

## Retention and deletion

- Subtitle cues and observed response bodies remain in page memory and are discarded when the playback page is reloaded or closed.
- Local extension settings remain until the user clears Safari extension data or removes the extension.
- Because the developer does not receive or store user data, there is no server-side user record to access, correct, export, or delete.

Users can stop processing at any time by disabling bilingual subtitles, revoking the extension's website permission in Safari Settings, disabling the extension, or uninstalling the containing app.

## Children

Dual Subtitle Companion does not knowingly collect personal information from children. Use of any supported third-party service remains subject to that service's age requirements and parental controls.

## Security

The project minimizes permissions to the supported website domain and performs subtitle processing locally. No method of software operation is completely risk-free, so users should keep Safari and macOS updated and install builds only from sources they trust.

## Third-party services

Dual Subtitle Companion is unofficial and is not affiliated with, endorsed by, sponsored by, or approved by Netflix, Inc. or any other streaming service. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for additional terms and limitations.

## Changes to this policy

Material changes will be published in this repository with an updated effective date. Continued use after an update is subject to the revised policy.

## Contact and support

Questions about this policy or the project can be submitted through [GitHub Issues](https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/issues). Do not post account credentials, cookies, tokens, subtitle content, captured responses, or other personal or third-party content in a public issue.
