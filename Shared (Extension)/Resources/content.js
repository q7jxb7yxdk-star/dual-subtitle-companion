(() => {
    "use strict";

    if (window.top !== window || window.__dualSubtitleCompanionLoaded) return;
    window.__dualSubtitleCompanionLoaded = true;

    const SOURCE = "dual-subtitle-companion-page-bridge";
    const EXTENSION_SOURCE = "dual-subtitle-companion-extension";
    const ENABLED_STORAGE_KEY = "dualSubtitlesEnabled";
    const REVISION_STORAGE_KEY = "dualSubtitlesRevision";
    const NATIVE_TRACK_STORAGE_KEY = "nativeSubtitleTrackId";
    const state = {
        bridgeActive: false,
        tracks: [],
        english: null,
        traditionalChinese: null,
        controlledProbeRequested: false,
        controlledProbeRestored: false,
        nativeSubtitleDisableRequested: false,
        dualSubtitlesEnabled: false,
        enabledRevision: 0,
        enabledSettingLoaded: false,
        savedNativeTrackId: ""
    };

    function fetchableTrackURL(value) {
        if (typeof value !== "string" || !value.trim()) return null;
        try {
            const url = new URL(value, location.href);
            if (url.protocol !== "https:" || (url.origin === location.origin && url.pathname.startsWith("/watch/"))) return null;
            return url.href;
        } catch { return null; }
    }

    async function loadEnabledSetting() {
        try {
            const stored = await browser.storage.local.get([ENABLED_STORAGE_KEY, REVISION_STORAGE_KEY, NATIVE_TRACK_STORAGE_KEY]);
            state.savedNativeTrackId = typeof stored[NATIVE_TRACK_STORAGE_KEY] === "string" ? stored[NATIVE_TRACK_STORAGE_KEY] : "";
            setEnabledState(stored[ENABLED_STORAGE_KEY] === true, Number(stored[REVISION_STORAGE_KEY]) || 0, true);
        } catch {
            setEnabledState(false, 0, true);
        }
    }

    function setEnabledState(enabled, revision = 0, force = false) {
        const nextEnabled = enabled === true;
        const nextRevision = Number(revision) || 0;
        if (nextRevision < state.enabledRevision) return false;
        if (!force && state.enabledSettingLoaded && state.dualSubtitlesEnabled === nextEnabled && nextRevision === state.enabledRevision) return false;
        const wasEnabled = state.dualSubtitlesEnabled;
        state.dualSubtitlesEnabled = nextEnabled;
        state.enabledRevision = Math.max(state.enabledRevision, nextRevision);
        state.enabledSettingLoaded = true;
        if (nextEnabled && !wasEnabled) {
            state.controlledProbeRequested = false;
            state.controlledProbeRestored = false;
            state.nativeSubtitleDisableRequested = false;
        }
        applyEnabledState();
        return true;
    }

    function applyEnabledState() {
        window.DualSubtitleRenderer.setEnabled(state.dualSubtitlesEnabled);
        window.postMessage({
            source: EXTENSION_SOURCE,
            type: "set-dual-subtitles-enabled",
            enabled: state.dualSubtitlesEnabled,
            revision: state.enabledRevision,
            savedNativeTrackId: state.savedNativeTrackId
        }, location.origin);
        if (state.dualSubtitlesEnabled) {
            maybeStartControlledProbe();
            reconcileControlledProbe();
        } else {
            state.nativeSubtitleDisableRequested = false;
            state.controlledProbeRequested = false;
        }
    }

    function injectBridge() {
        const root = document.head || document.documentElement;
        if (!root) {
            setTimeout(injectBridge, 0);
            return;
        }
        const script = document.createElement("script");
        script.src = browser.runtime.getURL("page-bridge.js");
        script.dataset.dualSubtitleCompanionBridge = "true";
        script.onload = () => script.remove();
        script.onerror = () => script.remove();
        root.appendChild(script);
    }

    async function ingestBody(payload) {
        const result = await window.DualSubtitleDetector.ingest(payload);
        applyDetectorResult(result);
        if (payload.probeCaptureId) {
            const target = result.tracks.find((track) => payload.probeTrackId && track.trackId === payload.probeTrackId)
                || (payload.probeLanguage === "English" ? result.english : result.traditionalChinese);
            window.postMessage({
                source: EXTENSION_SOURCE,
                type: "candidate-result",
                captureId: payload.probeCaptureId,
                url: payload.url,
                cueCount: target?.cues?.length || 0
            }, location.origin);
        }

        for (const track of result.tracks) {
            const url = fetchableTrackURL(track.url);
            if (!track.cues?.length && url && !track.fetchRequested) {
                track.fetchRequested = true;
                window.postMessage({ source: EXTENSION_SOURCE, type: "fetch-track", url }, location.origin);
            }
        }
    }

    function applyDetectorResult(result) {
        if (result.tracks.length) state.tracks = result.tracks;
        state.english = result.english || state.english;
        state.traditionalChinese = result.traditionalChinese || state.traditionalChinese;
        window.DualSubtitleRenderer.setTracks(state.english, state.traditionalChinese);
        reconcileControlledProbe();
        maybeStartControlledProbe();
    }

    function reconcileControlledProbe() {
        if (!state.dualSubtitlesEnabled || !state.controlledProbeRestored) return;
        if (state.english?.cues?.length && state.traditionalChinese?.cues?.length && !state.nativeSubtitleDisableRequested) {
            state.nativeSubtitleDisableRequested = true;
            window.postMessage({ source: EXTENSION_SOURCE, type: "disable-native-subtitles" }, location.origin);
        }
    }

    function maybeStartControlledProbe() {
        if (!state.enabledSettingLoaded || !state.dualSubtitlesEnabled || state.controlledProbeRequested || !state.bridgeActive || !state.english || !state.traditionalChinese) return;
        state.controlledProbeRequested = true;
        window.postMessage({ source: EXTENSION_SOURCE, type: "start-controlled-probe" }, location.origin);
    }

    window.addEventListener("message", (event) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const payload = event.data;
        if (!payload || payload.source !== SOURCE || typeof payload.type !== "string") return;
        if (payload.type === "ready") {
            state.bridgeActive = true;
            if (state.enabledSettingLoaded) applyEnabledState();
        } else if (payload.type === "candidate" && typeof payload.body === "string") {
            void ingestBody(payload).catch(() => {});
        } else if (payload.type === "resource-url" && typeof payload.url === "string") {
            applyDetectorResult(window.DualSubtitleDetector.ingestURL(payload.url));
        } else if (payload.type === "player-probe") {
            if (Array.isArray(payload.tracks) && payload.tracks.length) {
                applyDetectorResult(window.DualSubtitleDetector.ingestPlayerTracks(payload.tracks));
            }
        } else if (payload.type === "controlled-probe") {
            if (payload.phase === "restored") state.controlledProbeRestored = true;
            if (payload.phase === "selected" && payload.captureId && payload.track?.trackId) {
                const cached = state.tracks.find((track) => track.trackId === payload.track.trackId && track.cues?.length);
                if (cached) {
                    window.postMessage({
                        source: EXTENSION_SOURCE,
                        type: "candidate-result",
                        captureId: payload.captureId,
                        url: cached.url || "cached-timed-text",
                        cueCount: cached.cues.length
                    }, location.origin);
                }
            }
            reconcileControlledProbe();
        } else if (payload.type === "native-subtitles") {
            settleToggleWaiters(payload);
        } else if (payload.type === "native-track-saved" && payload.track?.trackId) {
            state.savedNativeTrackId = payload.track.trackId;
            void browser.storage.local.set({ [NATIVE_TRACK_STORAGE_KEY]: state.savedNativeTrackId });
        }
    });

    function start() {
        void loadEnabledSetting();
        window.PlaybackPlayerProbe.start({
            onVideo(video) {
                window.DualSubtitleRenderer.setVideo(video);
            },
            onTextTracks(tracks) {
                applyDetectorResult(window.DualSubtitleDetector.ingestHTMLTracks(tracks));
            }
        });
    }

    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        if (changes[ENABLED_STORAGE_KEY] || changes[REVISION_STORAGE_KEY]) {
            const enabled = changes[ENABLED_STORAGE_KEY]?.newValue ?? state.dualSubtitlesEnabled;
            const revision = changes[REVISION_STORAGE_KEY]?.newValue ?? state.enabledRevision;
            setEnabledState(enabled === true, revision);
        }
    });

    const toggleWaiters = [];

    function waitForNativeSubtitleResult(enabled, revision) {
        return new Promise((resolve) => {
            const waiter = { enabled, revision, resolve, timer: null };
            waiter.timer = setTimeout(() => {
                const index = toggleWaiters.indexOf(waiter);
                if (index >= 0) toggleWaiters.splice(index, 1);
                resolve({ ok: false, enabled, error: "Timed out waiting for the subtitle state" });
            }, 45000);
            toggleWaiters.push(waiter);
        });
    }

    function settleToggleWaiters(payload) {
        const successEnabled = payload.status === "disabled" ? true : (payload.status === "restored" ? false : null);
        for (const waiter of [...toggleWaiters]) {
            if (waiter.revision < state.enabledRevision) {
                clearTimeout(waiter.timer);
                toggleWaiters.splice(toggleWaiters.indexOf(waiter), 1);
                waiter.resolve({ ok: false, enabled: waiter.enabled, error: "Superseded by a newer toggle" });
            } else if (successEnabled === waiter.enabled || payload.status === "failed" || payload.status === "restore-failed") {
                clearTimeout(waiter.timer);
                toggleWaiters.splice(toggleWaiters.indexOf(waiter), 1);
                waiter.resolve({ ok: successEnabled === waiter.enabled, enabled: waiter.enabled, error: payload.message || null });
            }
        }
    }

    browser.runtime.onMessage.addListener((message) => {
        if (message?.type !== "set-dual-subtitles-enabled") return undefined;
        const revision = Number(message.revision) || Date.now();
        setEnabledState(message.enabled === true, revision);
        return waitForNativeSubtitleResult(message.enabled === true, revision);
    });

    injectBridge();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
})();
