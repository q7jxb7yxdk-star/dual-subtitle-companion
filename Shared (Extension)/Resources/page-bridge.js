(() => {
    "use strict";
    if (window.__dualSubtitleCompanionPageBridge) return;
    window.__dualSubtitleCompanionPageBridge = true;

    const PAGE_SOURCE = "dual-subtitle-companion-page-bridge";
    const EXTENSION_SOURCE = "dual-subtitle-companion-extension";
    const MAX_BODY = 8 * 1024 * 1024;
    const CAPTURE_TIMEOUT = 12000;
    const SWITCH_SETTLE_DELAY = 250;
    const PLAYER_WAIT_TIMEOUT = 15000;
    let activeCapture = null;
    let controlledProbeStarted = false;
    let captureSequence = 0;
    let dualSubtitlesEnabled = false;
    let savedNativeTrack = null;
    let savedNativeTrackId = "";
    let enabledRevision = 0;
    let nativeOperation = Promise.resolve();
    const post = (message) => window.postMessage({ source: PAGE_SOURCE, ...message }, location.origin);
    const relevant = (url, type = "") => /(?:manifest|timedtext|subtitle|caption|\.vtt|\.dfxp|\.ttml)/i.test(`${url} ${type}`);
    const safeURL = (value) => {
        try {
            const url = new URL(String(value || ""), location.href);
            return `${url.origin}${url.pathname}`;
        } catch { return "unknown"; }
    };

    function looksLikeMSL(body) {
        const head = body.slice(0, 300000);
        return /"(?:headerdata|payload|mastertoken)"\s*:/i.test(head);
    }

    function publish(url, contentType, body, kind, requestTrack = null) {
        if (typeof body !== "string" || body.length > MAX_BODY) return false;
        if (looksLikeMSL(body)) return false;
        if (!relevant(url, contentType) && !/(?:timedtexttracks|ttDownloadables|WEBVTT|<tt[\s>])/i.test(body.slice(0, 200000))) return false;
        const selected = requestTrack || currentTrackContext();
        const capture = activeCapture ? {
            probeCaptureId: activeCapture.id,
            probeLanguage: activeCapture.language,
            probeTrackId: activeCapture.trackId
        } : {};
        post({
            type: "candidate",
            url,
            contentType,
            body,
            kind,
            observedTrackId: selected?.trackId || "",
            observedLanguage: selected ? (isEnglish(selected) ? "English" : (isTraditionalChinese(selected) ? "Traditional Chinese" : "")) : "",
            ...capture
        });
        return true;
    }

    const nativeFetch = window.fetch;
    window.fetch = async function (...args) {
        const requestTrack = currentTrackContext();
        const response = await nativeFetch.apply(this, args);
        try {
            const url = response.url || String(args[0]?.url || args[0] || "");
            const contentType = response.headers.get("content-type") || "";
            const contentLength = Number(response.headers.get("content-length") || 0);
            const inspectJSON = /json/i.test(contentType) && (!contentLength || contentLength <= MAX_BODY);
            if (relevant(url, contentType) || inspectJSON) response.clone().text().then((body) => publish(url, contentType, body, "fetch", requestTrack)).catch(() => {});
        } catch (error) { post({ type: "bridge-error", message: `fetch observation: ${error.message}` }); }
        return response;
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__ndsURL = String(url || "");
        return nativeOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
        this.__ndsTrack = currentTrackContext();
        this.addEventListener("load", async () => {
            const url = this.responseURL || this.__ndsURL;
            const responseType = this.responseType || "text";
            try {
                const type = this.getResponseHeader("content-type") || "";
                let body = "";
                if (this.responseType === "json" && this.response) body = JSON.stringify(this.response);
                else if (this.responseType === "" || this.responseType === "text") body = this.responseText;
                else if (this.responseType === "arraybuffer" && this.response instanceof ArrayBuffer) {
                    if (this.response.byteLength > MAX_BODY) return;
                    body = new TextDecoder("utf-8").decode(this.response);
                } else if (this.responseType === "blob" && this.response instanceof Blob) {
                    if (this.response.size > MAX_BODY) return;
                    body = await this.response.text();
                }
                if (body) publish(url, type, body, "xhr", this.__ndsTrack);
            } catch {}
        }, { once: true });
        return nativeSend.apply(this, args);
    };

    function serializableTracks(value) {
        const list = Array.isArray(value) ? value : (value && typeof value[Symbol.iterator] === "function" ? Array.from(value) : []);
        return list.slice(0, 100).map((track) => {
            const result = {};
            for (const key of ["id", "trackId", "type", "trackType", "rawTrackType", "kind", "language", "languageCode", "bcp47", "locale", "label", "displayName", "isNoneTrack", "isForcedNarrative", "isImageBased"]) {
                const item = track?.[key];
                if (["string", "number", "boolean"].includes(typeof item)) result[key] = item;
            }
            return result;
        }).filter((track) => Object.keys(track).length);
    }

    function playerAndTracks() {
        const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.();
        const videoPlayer = api?.videoPlayer;
        const sessions = videoPlayer?.getAllPlayerSessionIds?.() || [];
        const player = sessions.length ? videoPlayer.getVideoPlayerBySessionId?.(sessions[0]) : null;
        if (!player) return { player: null, tracks: [] };
        const getter = ["getTimedTextTrackList", "getTextTrackList", "getTimedTextTracks", "getSubtitleTracks"]
            .find((name) => typeof player[name] === "function");
        return { player, tracks: getter ? player[getter]() : [] };
    }

    async function waitForPlayerAndTracks(timeout = PLAYER_WAIT_TIMEOUT) {
        const deadline = performance.now() + timeout;
        while (performance.now() < deadline) {
            const context = playerAndTracks();
            if (context.player) {
                const value = await Promise.resolve(context.tracks);
                return { player: context.player, tracks: Array.isArray(value) ? value : Array.from(value || []) };
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(`Playback session unavailable after ${timeout / 1000}s`);
    }

    function currentPlayer() {
        return playerAndTracks().player;
    }

    function currentTrackContext() {
        try { return currentTimedTextTrack(currentPlayer()); } catch { return null; }
    }

    function languageText(track) {
        return [track?.language, track?.languageCode, track?.bcp47, track?.locale, track?.label, track?.displayName]
            .filter(Boolean).join(" ").toLowerCase();
    }

    function isEnglish(track) {
        const value = languageText(track);
        return /(^|[\s_-])en(?:[\s_-]|$)/.test(value) || /\benglish\b/.test(value);
    }

    function isTraditionalChinese(track) {
        const value = languageText(track);
        if (/zh[-_ ]?(?:hans|cn|sg)\b/.test(value) || /简体|簡體|simplified/.test(value)) return false;
        return /zh[-_ ]?(?:hant|tw|hk|mo)\b/.test(value) || /繁體|繁体|traditional chinese|chinese traditional/.test(value);
    }

    function selectTrack(tracks, predicate) {
        return tracks.filter((track) => !track?.isNoneTrack && !track?.isForcedNarrative && !track?.isImageBased && predicate(track))
            .sort((left, right) => {
                const score = (track) => (track?.rawTrackType === "SUBTITLES" ? 4 : 0) + (track?.trackType === "PRIMARY" ? 2 : 0) - (track?.rawTrackType === "CLOSEDCAPTIONS" ? 1 : 0);
                return score(right) - score(left);
            })[0] || null;
    }

    function currentTimedTextTrack(player) {
        for (const name of ["getTimedTextTrack", "getTextTrack"]) {
            if (typeof player?.[name] === "function") return player[name]();
        }
        return null;
    }

    async function setTimedTextTrack(player, track) {
        const method = ["setTimedTextTrack", "setTextTrack"].find((name) => typeof player?.[name] === "function");
        if (!method) throw new Error("The player exposes no timed-text setter");
        await Promise.resolve(player[method](track));
    }

    async function waitForSelectedTrack(player, target, timeout = 2500) {
        const deadline = performance.now() + timeout;
        while (performance.now() < deadline) {
            const selected = currentTimedTextTrack(player);
            if (selected?.trackId && selected.trackId === target?.trackId) return selected;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const selected = currentTimedTextTrack(player);
        throw new Error(`Player did not select ${target?.displayName || target?.bcp47 || target?.trackId || "target track"}; current=${selected?.trackId || "unknown"}`);
    }

    async function disableNativeSubtitles() {
        try {
            if (!dualSubtitlesEnabled) throw new Error("Dual subtitles are disabled");
            const { player, tracks } = await waitForPlayerAndTracks();
            const noneTrack = tracks.find((track) => track?.isNoneTrack);
            if (!noneTrack) throw new Error("The None subtitle track is unavailable");
            const current = currentTimedTextTrack(player);
            if (current && !current.isNoneTrack) {
                savedNativeTrack = current;
                savedNativeTrackId = current.trackId || "";
                post({ type: "native-track-saved", track: trackSummary(current) });
            }
            await setTimedTextTrack(player, noneTrack);
            const deadline = performance.now() + 2500;
            while (performance.now() < deadline) {
                const selected = currentTimedTextTrack(player);
                if (!dualSubtitlesEnabled) throw new Error("Dual subtitles were disabled during the operation");
                if (selected?.isNoneTrack === true || (selected?.trackId && selected.trackId === noneTrack.trackId)) {
                    post({ type: "native-subtitles", status: "disabled", track: trackSummary(noneTrack) });
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            throw new Error(`Player did not select None; current=${currentTimedTextTrack(player)?.trackId || "unknown"}`);
        } catch (error) {
            post({ type: "native-subtitles", status: "failed", message: error.message });
        }
    }

    async function restoreNativeSubtitles() {
        try {
            const { player, tracks } = await waitForPlayerAndTracks();
            const targetId = savedNativeTrackId || savedNativeTrack?.trackId || "";
            let target = tracks.find((track) => track?.trackId && track.trackId === targetId) || savedNativeTrack;
            if (!target || target.isNoneTrack) target = selectTrack(tracks, isTraditionalChinese) || selectTrack(tracks, isEnglish);
            if (!target || target.isNoneTrack) throw new Error("No restorable subtitle track is available");
            await setTimedTextTrack(player, target);
            const selected = await waitForSelectedTrack(player, target);
            if (selected?.isNoneTrack) throw new Error("The player remained on the None subtitle track");
            post({ type: "native-subtitles", status: "restored", track: trackSummary(selected) });
        } catch (error) {
            post({ type: "native-subtitles", status: "restore-failed", message: error.message });
        }
    }

    function trackSummary(track) {
        return serializableTracks(track ? [track] : [])[0] || null;
    }

    function waitForCandidate(language, track) {
        return new Promise((resolve, reject) => {
            const id = ++captureSequence;
            const timer = setTimeout(() => {
                if (activeCapture?.id === id) activeCapture = null;
                reject(new Error(`${language} subtitle response timed out after ${CAPTURE_TIMEOUT / 1000}s`));
            }, CAPTURE_TIMEOUT);
            activeCapture = {
                id,
                language,
                trackId: track?.trackId || "",
                timer,
                resolve(details) {
                    clearTimeout(timer);
                    activeCapture = null;
                    resolve(details);
                },
                cancel() {
                    clearTimeout(timer);
                    activeCapture = null;
                    resolve({ cancelled: true });
                }
            };
        });
    }

    async function captureTrack(player, language, track) {
        post({ type: "controlled-probe", status: `Switching to ${language}`, phase: "switch", language, track: trackSummary(track) });
        const candidate = waitForCandidate(language, track);
        try {
            await setTimedTextTrack(player, track);
            const selected = await waitForSelectedTrack(player, track);
            await new Promise((resolve) => setTimeout(resolve, SWITCH_SETTLE_DELAY));
            post({
                type: "controlled-probe",
                status: `${language} selected; checking cache/network`,
                phase: "selected",
                language,
                captureId: activeCapture?.id || null,
                track: trackSummary(selected)
            });
            const details = await candidate;
            if (details.cancelled) throw new Error(`${language} capture cancelled`);
            post({ type: "controlled-probe", status: `${language} response captured`, phase: "captured", language, details });
        } catch (error) {
            if (activeCapture?.trackId === track?.trackId) {
                activeCapture.cancel();
            }
            throw error;
        }
    }

    async function runControlledProbe() {
        if (controlledProbeStarted) return;
        controlledProbeStarted = true;
        let player = null;
        let original = null;
        let outcome = "Probe did not complete";
        try {
            const context = await waitForPlayerAndTracks();
            player = context.player;
            const tracks = context.tracks;
            const english = selectTrack(tracks, isEnglish);
            const traditionalChinese = selectTrack(tracks, isTraditionalChinese);
            if (!english || !traditionalChinese) throw new Error("English and Traditional Chinese tracks are not both available");
            original = currentTimedTextTrack(player) || tracks.find((track) => track?.isNoneTrack) || null;
            if (original && !original.isNoneTrack) {
                savedNativeTrack = original;
                savedNativeTrackId = original.trackId || "";
                post({ type: "native-track-saved", track: trackSummary(original) });
            }
            post({ type: "controlled-probe", status: "Probe started; original track saved", phase: "started", original: trackSummary(original), english: trackSummary(english), traditionalChinese: trackSummary(traditionalChinese) });
            await captureTrack(player, "English", english);
            await captureTrack(player, "Traditional Chinese", traditionalChinese);
            outcome = "Both subtitle responses captured";
            post({ type: "controlled-probe", status: outcome, phase: "complete" });
        } catch (error) {
            outcome = `Probe failed: ${error.message}`;
            post({ type: "controlled-probe", status: outcome, phase: "failed" });
        } finally {
            if (activeCapture) clearTimeout(activeCapture.timer);
            activeCapture = null;
            if (player && original) {
                try {
                    await setTimedTextTrack(player, original);
                    post({ type: "controlled-probe", status: `${outcome}; original track restored`, phase: "restored", original: trackSummary(original) });
                    if (!dualSubtitlesEnabled) post({ type: "native-subtitles", status: "restored", track: trackSummary(original) });
                } catch (error) {
                    post({ type: "controlled-probe", status: `Restore failed: ${error.message}`, phase: "restore-failed" });
                }
            } else {
                post({ type: "controlled-probe", status: `${outcome}; no original track to restore`, phase: "restored" });
            }
            controlledProbeStarted = false;
        }
    }

    async function probePlayerTracks() {
        try {
            const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.();
            const videoPlayer = api?.videoPlayer;
            const sessions = videoPlayer?.getAllPlayerSessionIds?.() || [];
            if (!sessions.length) {
                post({ type: "player-probe", status: api ? "API found; no active session" : "API unavailable", tracks: [] });
                return;
            }
            const player = videoPlayer.getVideoPlayerBySessionId?.(sessions[0]);
            const methods = ["getTimedTextTrackList", "getTimedTextTracks", "getSubtitleTracks", "getTextTracks"];
            for (const method of methods) {
                if (typeof player?.[method] !== "function") continue;
                const tracks = serializableTracks(await player[method]());
                post({ type: "player-probe", status: `${method}: ${tracks.length} track(s)`, tracks });
                if (tracks.length) return;
            }
            const names = player ? Object.getOwnPropertyNames(Object.getPrototypeOf(player)).filter((name) => /(?:timed.?text|subtitle|text.?track)/i.test(name)).slice(0, 20) : [];
            post({ type: "player-probe", status: names.length ? `No safe list method; related methods: ${names.join(", ")}` : "Player found; track API unavailable", tracks: [] });
        } catch (error) {
            post({ type: "player-probe", status: `Probe failed: ${error.message}`, tracks: [] });
        }
    }

    function scanResources() {
        for (const entry of performance.getEntriesByType("resource")) {
            if (relevant(entry.name, entry.initiatorType)) post({ type: "resource-url", url: entry.name, initiatorType: entry.initiatorType });
        }
    }
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (relevant(entry.name, entry.initiatorType)) post({ type: "resource-url", url: entry.name, initiatorType: entry.initiatorType });
    }).observe({ type: "resource", buffered: true });

    window.addEventListener("message", async (event) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (!data || data.source !== EXTENSION_SOURCE) return;
        if (data.type === "start-controlled-probe") {
            void runControlledProbe();
            return;
        }
        if (data.type === "disable-native-subtitles") {
            nativeOperation = nativeOperation.then(() => disableNativeSubtitles());
            return;
        }
        if (data.type === "set-dual-subtitles-enabled") {
            const revision = Number(data.revision) || 0;
            if (revision < enabledRevision) return;
            enabledRevision = revision;
            dualSubtitlesEnabled = data.enabled === true;
            if (typeof data.savedNativeTrackId === "string" && data.savedNativeTrackId) savedNativeTrackId = data.savedNativeTrackId;
            if (!dualSubtitlesEnabled) nativeOperation = nativeOperation.then(() => restoreNativeSubtitles());
            return;
        }
        if (data.type === "candidate-result") {
            if (activeCapture && data.captureId === activeCapture.id && Number(data.cueCount) > 0) {
                activeCapture.resolve({ url: safeURL(data.url), cues: Number(data.cueCount) });
            }
            return;
        }
        if (data.type !== "fetch-track" || typeof data.url !== "string") return;
        let url;
        try { url = new URL(data.url, location.href); } catch { return; }
        if (url.protocol !== "https:" || (url.origin === location.origin && url.pathname.startsWith("/watch/"))) {
            post({ type: "bridge-error", message: `Rejected invalid track URL: ${safeURL(url)}` });
            return;
        }
        try {
            const response = await nativeFetch(url.href, { credentials: "include" });
            publish(response.url, response.headers.get("content-type") || "", await response.text(), "track-fetch");
        } catch (error) { post({ type: "bridge-error", message: `track fetch: ${error.message}` }); }
    });

    scanResources();
    void probePlayerTracks();
    setInterval(() => void probePlayerTracks(), 5000);
    post({ type: "ready" });
})();
