(() => {
    "use strict";

    const ROOT_ID = "dual-subtitle-companion-overlay";
    let video = null;
    let englishCues = [];
    let traditionalChineseCues = [];
    let animationFrame = 0;
    let enabled = false;
    let lastEnglish = null;
    let lastTraditionalChinese = null;

    function fullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || null;
    }

    function overlayHost() {
        const fullscreen = fullscreenElement();
        if (!fullscreen) return document.documentElement || document.body;
        if (fullscreen.localName !== "video") return fullscreen;
        return document.documentElement || document.body;
    }

    function normalizeCues(cues) {
        if (!Array.isArray(cues)) return [];
        return cues.map((cue) => ({
            start: Number(cue?.start),
            end: Number(cue?.end),
            text: String(cue?.text || "").trim()
        })).filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end >= cue.start && cue.text)
            .sort((left, right) => left.start - right.start || left.end - right.end);
    }

    function cueState(cues, time) {
        if (!cues.length || !Number.isFinite(time)) return { text: "", active: [], previous: null, next: null };
        let low = 0;
        let high = cues.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (cues[middle].start <= time) low = middle + 1;
            else high = middle;
        }
        const insertionIndex = low;
        const active = [];
        for (let index = insertionIndex - 1, inspected = 0; index >= 0 && inspected < 100; index -= 1, inspected += 1) {
            const cue = cues[index];
            if (time - cue.start > 120) break;
            if (cue.end >= time) active.unshift(cue);
        }
        return {
            text: active.map((cue) => cue.text).join("\n"),
            active,
            previous: insertionIndex > 0 ? cues[insertionIndex - 1] : null,
            next: insertionIndex < cues.length ? cues[insertionIndex] : null
        };
    }

    function mount() {
        let root = document.getElementById(ROOT_ID);
        if (!root) {
            root = document.createElement("div");
            root.id = ROOT_ID;
            root.setAttribute("aria-live", "off");
            const english = document.createElement("div");
            english.className = "dsc-subtitle-line dsc-subtitle-english";
            const traditionalChinese = document.createElement("div");
            traditionalChinese.className = "dsc-subtitle-line dsc-subtitle-traditional-chinese";
            root.append(english, traditionalChinese);
        }
        const host = overlayHost();
        if (host && root.parentNode !== host) host.appendChild(root);
        return root;
    }

    function tick() {
        const root = mount();
        const english = root.querySelector(".dsc-subtitle-english");
        const traditionalChinese = root.querySelector(".dsc-subtitle-traditional-chinese");
        const time = video?.isConnected ? video.currentTime : NaN;
        const englishState = cueState(englishCues, time);
        const traditionalChineseState = cueState(traditionalChineseCues, time);
        const nextEnglish = englishState.text;
        const nextTraditionalChinese = traditionalChineseState.text;
        if (nextEnglish !== lastEnglish) {
            english.textContent = nextEnglish;
            english.hidden = !nextEnglish;
            lastEnglish = nextEnglish;
        }
        if (nextTraditionalChinese !== lastTraditionalChinese) {
            traditionalChinese.textContent = nextTraditionalChinese;
            traditionalChinese.hidden = !nextTraditionalChinese;
            lastTraditionalChinese = nextTraditionalChinese;
        }
        root.hidden = !enabled || (!nextEnglish && !nextTraditionalChinese);
        animationFrame = requestAnimationFrame(tick);
    }

    window.DualSubtitleRenderer = {
        setVideo(nextVideo) {
            video = nextVideo;
            if (!animationFrame) animationFrame = requestAnimationFrame(tick);
        },
        setEnabled(nextEnabled) {
            enabled = nextEnabled === true;
            const root = document.getElementById(ROOT_ID);
            if (root && !enabled) root.hidden = true;
            if (!animationFrame) animationFrame = requestAnimationFrame(tick);
        },
        setTracks(english, traditionalChinese) {
            englishCues = normalizeCues(english?.cues);
            traditionalChineseCues = normalizeCues(traditionalChinese?.cues);
            lastEnglish = null;
            lastTraditionalChinese = null;
            if (!animationFrame) animationFrame = requestAnimationFrame(tick);
        }
    };

    const remountForFullscreen = () => {
        mount();
        lastEnglish = null;
        lastTraditionalChinese = null;
    };
    document.addEventListener("fullscreenchange", remountForFullscreen);
    document.addEventListener("webkitfullscreenchange", remountForFullscreen);
})();
