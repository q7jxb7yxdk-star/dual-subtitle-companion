(() => {
    "use strict";

    if (window.top !== window || window.__dualSubtitleCompanionLoaded) return;
    window.__dualSubtitleCompanionLoaded = true;

    const SOURCE = "dual-subtitle-companion-page-bridge";
    const EXTENSION_SOURCE = "dual-subtitle-companion-extension";
    const ENABLED_STORAGE_KEY = "dualSubtitlesEnabled";
    const REVISION_STORAGE_KEY = "dualSubtitlesRevision";
    const NATIVE_TRACK_STORAGE_KEY = "nativeSubtitleTrackId";
    const MAX_CONTROLLED_PROBE_ATTEMPTS = 3;
    const CONTROLLED_PROBE_RETRY_DELAY = 2000;
    const MAX_NATIVE_SUBTITLE_DISABLE_ATTEMPTS = 3;
    const NATIVE_SUBTITLE_RETRY_DELAY = 1500;
    const state = {
        bridgeActive: false,
        tracks: [],
        english: null,
        traditionalChinese: null,
        controlledProbeRequested: false,
        controlledProbeRestored: false,
        controlledProbeAttempts: 0,
        controlledProbeRetryTimer: null,
        nativeSubtitleDisableRequested: false,
        nativeSubtitleDisableAttempts: 0,
        nativeSubtitleRetryTimer: null,
        nativeSubtitleState: "unknown",
        dualSubtitlesEnabled: false,
        enabledRevision: 0,
        enabledSettingLoaded: false,
        savedNativeTrackId: "",
        originalAudioEligibility: "unknown",
        pageBridgeEffectiveEnabled: null
    };

    function clearControlledProbeRetry() {
        if (state.controlledProbeRetryTimer !== null) clearTimeout(state.controlledProbeRetryTimer);
        state.controlledProbeRetryTimer = null;
    }

    function resetControlledProbeCycle() {
        clearControlledProbeRetry();
        if (state.nativeSubtitleRetryTimer !== null) clearTimeout(state.nativeSubtitleRetryTimer);
        state.nativeSubtitleRetryTimer = null;
        state.controlledProbeRequested = false;
        state.controlledProbeRestored = false;
        state.controlledProbeAttempts = 0;
        state.nativeSubtitleDisableRequested = false;
        state.nativeSubtitleDisableAttempts = 0;
    }

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
        if (nextEnabled !== wasEnabled) resetControlledProbeCycle();
        applyEnabledState();
        return true;
    }

    function applyEnabledState() {
        const activationRequested = state.dualSubtitlesEnabled && state.originalAudioEligibility === "english";
        const rendererEnabled = activationRequested && state.nativeSubtitleState === "disabled";
        window.DualSubtitleRenderer.setEnabled(rendererEnabled);
        if (!state.dualSubtitlesEnabled || state.originalAudioEligibility !== "unknown" || state.pageBridgeEffectiveEnabled === true) {
            window.postMessage({
                source: EXTENSION_SOURCE,
                type: "set-dual-subtitles-enabled",
                enabled: activationRequested,
                revision: state.enabledRevision,
                savedNativeTrackId: state.savedNativeTrackId
            }, location.origin);
            state.pageBridgeEffectiveEnabled = activationRequested;
        }
        if (activationRequested) {
            maybeStartControlledProbe();
            reconcileControlledProbe();
        } else {
            clearControlledProbeRetry();
            if (state.nativeSubtitleRetryTimer !== null) clearTimeout(state.nativeSubtitleRetryTimer);
            state.nativeSubtitleRetryTimer = null;
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
        if (!state.dualSubtitlesEnabled || state.originalAudioEligibility !== "english" || !state.controlledProbeRestored) return;
        if (state.english?.cues?.length && state.traditionalChinese?.cues?.length && state.nativeSubtitleState !== "disabled" && !state.nativeSubtitleDisableRequested && state.nativeSubtitleDisableAttempts < MAX_NATIVE_SUBTITLE_DISABLE_ATTEMPTS) {
            state.nativeSubtitleDisableRequested = true;
            state.nativeSubtitleDisableAttempts += 1;
            window.postMessage({ source: EXTENSION_SOURCE, type: "disable-native-subtitles" }, location.origin);
        }
    }

    function canRetryNativeSubtitleDisable() {
        return state.dualSubtitlesEnabled
            && state.originalAudioEligibility === "english"
            && state.controlledProbeRestored
            && state.english?.cues?.length
            && state.traditionalChinese?.cues?.length
            && state.nativeSubtitleDisableAttempts < MAX_NATIVE_SUBTITLE_DISABLE_ATTEMPTS;
    }

    function scheduleNativeSubtitleDisableRetry() {
        if (!canRetryNativeSubtitleDisable()) return false;
        if (state.nativeSubtitleRetryTimer !== null) clearTimeout(state.nativeSubtitleRetryTimer);
        state.nativeSubtitleRetryTimer = setTimeout(() => {
            state.nativeSubtitleRetryTimer = null;
            reconcileControlledProbe();
        }, NATIVE_SUBTITLE_RETRY_DELAY);
        return true;
    }

    function maybeStartControlledProbe() {
        if (!state.enabledSettingLoaded || !state.dualSubtitlesEnabled || state.originalAudioEligibility !== "english" || state.controlledProbeRequested || state.controlledProbeAttempts >= MAX_CONTROLLED_PROBE_ATTEMPTS || !state.bridgeActive || !state.english || !state.traditionalChinese) return;
        clearControlledProbeRetry();
        state.controlledProbeRequested = true;
        state.controlledProbeRestored = false;
        state.controlledProbeAttempts += 1;
        window.postMessage({ source: EXTENSION_SOURCE, type: "start-controlled-probe" }, location.origin);
    }

    function scheduleControlledProbeRetry() {
        if (!state.dualSubtitlesEnabled || state.originalAudioEligibility !== "english" || (state.english?.cues?.length && state.traditionalChinese?.cues?.length) || state.controlledProbeAttempts >= MAX_CONTROLLED_PROBE_ATTEMPTS) return;
        clearControlledProbeRetry();
        state.controlledProbeRetryTimer = setTimeout(() => {
            state.controlledProbeRetryTimer = null;
            state.controlledProbeRequested = false;
            maybeStartControlledProbe();
        }, CONTROLLED_PROBE_RETRY_DELAY);
    }

    function audioLanguageText(track) {
        return [track?.language, track?.languageCode, track?.bcp47, track?.locale, track?.label, track?.displayName]
            .filter(Boolean).join(" ").toLowerCase();
    }

    function isEnglishAudio(track) {
        const value = audioLanguageText(track);
        return /(^|[\s_-])en(?:[\s_-]|$)/.test(value) || /\benglish\b/.test(value);
    }

    function isExplicitOriginalAudio(track) {
        return track?.isNative === true || track?.isOriginal === true || track?.original === true;
    }

    function updateOriginalAudioEligibility(tracks) {
        if (!Array.isArray(tracks) || !tracks.length) return;
        const originalTracks = tracks.filter(isExplicitOriginalAudio);
        const nextEligibility = !originalTracks.length
            ? "unknown"
            : (originalTracks.some(isEnglishAudio) ? "english" : "non-english");
        if (nextEligibility === state.originalAudioEligibility) return;
        state.originalAudioEligibility = nextEligibility;
        resetControlledProbeCycle();
        applyEnabledState();
        settleEligibilityWaiters();
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
        } else if (payload.type === "audio-player-probe") {
            updateOriginalAudioEligibility(payload.tracks);
        } else if (payload.type === "controlled-probe") {
            if (payload.phase === "restored") {
                state.controlledProbeRestored = true;
                scheduleControlledProbeRetry();
            }
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
            if (payload.status === "failed") {
                state.nativeSubtitleState = "unknown";
                state.nativeSubtitleDisableRequested = false;
                window.DualSubtitleRenderer.setEnabled(false);
                if (scheduleNativeSubtitleDisableRetry()) return;
            }
            if (payload.status === "disabled" && state.nativeSubtitleRetryTimer !== null) {
                clearTimeout(state.nativeSubtitleRetryTimer);
                state.nativeSubtitleRetryTimer = null;
            }
            settleToggleWaiters(payload);
            applyEnabledState();
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
        if (payload.status === "disabled") state.nativeSubtitleState = "disabled";
        else if (payload.status === "restored") state.nativeSubtitleState = "restored";
        else if (payload.status === "failed" || payload.status === "restore-failed") state.nativeSubtitleState = "unknown";
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

    function settleEligibilityWaiters() {
        if (state.originalAudioEligibility === "unknown") return;
        for (const waiter of [...toggleWaiters]) {
            if (!waiter.enabled || state.originalAudioEligibility === "english") continue;
            clearTimeout(waiter.timer);
            toggleWaiters.splice(toggleWaiters.indexOf(waiter), 1);
            waiter.resolve({ ok: false, enabled: true, error: "此影片不是英語原聲，已保留網站原生字幕" });
        }
    }

    function toggleAlreadySatisfied(enabled) {
        return enabled ? state.nativeSubtitleState === "disabled" : state.nativeSubtitleState === "restored";
    }

    browser.runtime.onMessage.addListener((message) => {
        if (message?.type === "dual-subtitle-content-ready") return Promise.resolve({ ready: true });
        if (message?.type !== "set-dual-subtitles-enabled") return undefined;
        const revision = Number(message.revision) || Date.now();
        setEnabledState(message.enabled === true, revision);
        if (message.enabled === true && state.originalAudioEligibility === "non-english") {
            return Promise.resolve({ ok: false, enabled: true, error: "此影片不是英語原聲，已保留網站原生字幕" });
        }
        if (toggleAlreadySatisfied(message.enabled === true)) {
            return Promise.resolve({ ok: true, enabled: message.enabled === true, error: null });
        }
        return waitForNativeSubtitleResult(message.enabled === true, revision);
    });

    injectBridge();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
})();
