(() => {
    "use strict";

    if (window.top !== window || window.__dualSubtitleCompanionBootstrap) return;
    window.__dualSubtitleCompanionBootstrap = true;

    let requestedURL = "";
    let requestPending = false;

    function playbackURL() {
        try {
            const url = new URL(location.href);
            if (url.protocol !== "https:" || url.hostname !== "www.netflix.com" || !url.pathname.startsWith("/watch/")) return "";
            return url.href;
        } catch {
            return "";
        }
    }

    async function requestActivation(url) {
        requestPending = true;
        try {
            const response = await browser.runtime.sendMessage({ type: "ensure-playback-scripts" });
            requestedURL = response?.ok === true ? url : "";
        } catch {
            requestedURL = "";
        } finally {
            requestPending = false;
        }
    }

    function checkRoute() {
        const url = playbackURL();
        if (!url) {
            requestedURL = "";
            return;
        }
        if (!requestPending && url !== requestedURL) void requestActivation(url);
    }

    setTimeout(checkRoute, 500);
    setInterval(checkRoute, 500);
})();
