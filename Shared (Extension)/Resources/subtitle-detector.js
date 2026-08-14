(() => {
    "use strict";

    const tracks = new Map();

    function languageText(track) {
        return [track.language, track.languageCode, track.bcp47, track.locale, track.label, track.displayName].filter(Boolean).join(" ").toLowerCase();
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

    function subtitleURL(value) {
        if (typeof value !== "string") return false;
        if (!/(?:timedtext|subtitle|caption|\.vtt(?:\?|$)|\.dfxp(?:\?|$)|\.ttml(?:\?|$)|\.xml(?:\?|$))/i.test(value)) return false;
        try {
            const url = new URL(value, location.href);
            return url.protocol === "https:" && !(url.origin === location.origin && url.pathname.startsWith("/watch/"));
        } catch { return false; }
    }

    function fetchableURL(value) {
        if (typeof value !== "string" || !value.trim()) return null;
        try {
            const url = new URL(value, location.href);
            if (url.protocol !== "https:" || (url.origin === location.origin && url.pathname.startsWith("/watch/"))) return null;
            return url.href;
        } catch { return null; }
    }

    function chooseURL(node) {
        if (!node || typeof node !== "object") return null;
        const preferredProfiles = ["webvtt-lssdh-ios8", "dfxp-ls-sdh", "simplesdh"];
        for (const profile of preferredProfiles) {
            const urls = node.ttDownloadables?.[profile]?.downloadUrls;
            if (urls && typeof urls === "object") {
                const url = Object.values(urls).find((item) => typeof item === "string");
                const validURL = fetchableURL(url);
                if (validURL) return { url: validURL, format: profile };
            }
        }
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === "string" && subtitleURL(value)) return { url: value, format: key };
        }
        return null;
    }

    function normalizeTrack(node) {
        const resource = chooseURL(node) || {};
        const language = node.language || node.languageCode || node.bcp47 || node.locale || "";
        const label = node.label || node.displayName || node.trackType || language || "Unknown";
        return {
            id: node.id || null,
            trackId: node.trackId || null,
            language,
            label,
            trackType: node.trackType || null,
            rawTrackType: node.rawTrackType || null,
            isForcedNarrative: Boolean(node.isForcedNarrative),
            isImageBased: Boolean(node.isImageBased),
            url: resource.url || fetchableURL(node.url) || null,
            format: resource.format || node.format || "unknown",
            cues: node.cues || []
        };
    }

    function collect(value) {
        const found = [];
        const seen = new Set();
        const trackKeys = new Set(["timedtexttracks", "timedtexttrack", "subtitletracks", "subtitletrack", "captiontracks", "captiontrack"]);
        function visit(node, key = "") {
            if (!node || typeof node !== "object" || seen.has(node)) return;
            seen.add(node);
            const looksLikeTrack = trackKeys.has(key.toLowerCase()) && (node.language || node.languageCode || node.bcp47 || node.locale);
            const hasDownloadable = node.ttDownloadables || chooseURL(node);
            if (looksLikeTrack || (hasDownloadable && (node.language || node.languageCode || node.bcp47 || node.locale))) found.push(normalizeTrack(node));
            for (const [childKey, child] of Object.entries(node)) visit(child, childKey);
        }
        visit(value);
        return found;
    }

    function merge(track) {
        const key = track.trackId || track.id || `${track.language}|${track.label}|${track.rawTrackType || track.trackType || "track"}|${track.url || "html"}`;
        const previous = tracks.get(key);
        tracks.set(key, { ...previous, ...track, cues: track.cues?.length ? track.cues : (previous?.cues || []) });
    }

    function result() {
        const list = Array.from(tracks.values());
        return {
            tracks: list,
            english: list.find((track) => isEnglish(track) && track.cues?.length) || list.find((track) => isEnglish(track) && track.rawTrackType === "SUBTITLES") || list.find(isEnglish) || null,
            traditionalChinese: list.find((track) => isTraditionalChinese(track) && track.cues?.length) || list.find(isTraditionalChinese) || null
        };
    }

    window.DualSubtitleDetector = {
        ingestURL(url) {
            if (subtitleURL(url)) merge({ language: "", label: "Unclassified resource", url, format: "unknown", cues: [] });
            return result();
        },
        ingestHTMLTracks(items) {
            for (const item of items) merge({ ...item, url: null, format: "html5-texttrack" });
            return result();
        },
        ingestPlayerTracks(items) {
            for (const item of items) {
                const type = `${item.type || ""} ${item.trackType || ""} ${item.kind || ""}`.toLowerCase();
                if (/(?:audio|video)/.test(type)) continue;
                merge(normalizeTrack({ ...item, format: "player-metadata" }));
            }
            return result();
        },
        async ingest(payload) {
            let parsedJSON = null;
            try { parsedJSON = JSON.parse(payload.body); } catch { /* not JSON */ }
            if (parsedJSON) for (const track of collect(parsedJSON)) merge(track);
            const cues = window.DualSubtitleParser.parse(payload.body, payload.url || payload.contentType || "");
            if (cues.length) {
                const matching = Array.from(tracks.values()).find((track) => payload.observedTrackId && track.trackId === payload.observedTrackId)
                    || Array.from(tracks.values()).find((track) => payload.probeTrackId && track.trackId === payload.probeTrackId)
                    || Array.from(tracks.values()).find((track) => payload.probeLanguage === "English" && isEnglish(track) && track.rawTrackType === "SUBTITLES")
                    || Array.from(tracks.values()).find((track) => payload.probeLanguage === "Traditional Chinese" && isTraditionalChinese(track))
                    || Array.from(tracks.values()).find((track) => payload.observedLanguage === "English" && isEnglish(track) && track.rawTrackType === "SUBTITLES")
                    || Array.from(tracks.values()).find((track) => payload.observedLanguage === "Traditional Chinese" && isTraditionalChinese(track))
                    || Array.from(tracks.values()).find((track) => track.url === payload.url);
                if (matching) merge({ ...matching, cues });
                else {
                    const languageName = payload.probeLanguage || payload.observedLanguage || "";
                    merge({ language: languageName === "English" ? "en" : (languageName === "Traditional Chinese" ? "zh-Hant" : ""), label: languageName || "Unclassified parsed timed text", url: payload.url || null, format: payload.contentType || "unknown", cues });
                }
            }
            return result();
        },
        result
    };
})();
