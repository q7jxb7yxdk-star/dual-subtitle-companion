const PLAYBACK_URL_PATTERN = /^https:\/\/www\.netflix\.com\/watch\//;
const CONTENT_SCRIPT_FILES = [
    "subtitle-parser.js",
    "subtitle-detector.js",
    "subtitle-renderer.js",
    "playback-player.js",
    "content.js"
];
const pendingInjections = new Map();

function isPlaybackURL(value) {
    if (typeof value !== "string" || !PLAYBACK_URL_PATTERN.test(value)) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "www.netflix.com" && url.pathname.startsWith("/watch/");
    } catch {
        return false;
    }
}

async function contentIsReady(tabId) {
    try {
        const response = await browser.tabs.sendMessage(tabId, { type: "dual-subtitle-content-ready" });
        return response?.ready === true;
    } catch {
        return false;
    }
}

async function injectPlaybackScripts(tabId) {
    const tab = await browser.tabs.get(tabId);
    if (!isPlaybackURL(tab?.url)) throw new Error("The target tab is not a Netflix playback page");
    if (await contentIsReady(tabId)) return { ok: true, injected: false };

    await browser.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"]
    });
    await browser.scripting.executeScript({
        target: { tabId },
        files: CONTENT_SCRIPT_FILES
    });
    if (!await contentIsReady(tabId)) throw new Error("Playback scripts did not become ready");
    return { ok: true, injected: true };
}

async function ensurePlaybackScripts(tabId) {
    if (!Number.isInteger(tabId)) throw new Error("A valid tab ID is required");
    if (pendingInjections.has(tabId)) return pendingInjections.get(tabId);

    const task = injectPlaybackScripts(tabId);
    pendingInjections.set(tabId, task);
    try {
        return await task;
    } finally {
        pendingInjections.delete(tabId);
    }
}

browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "ensure-playback-scripts") return undefined;
    const tabId = sender.tab?.id ?? message.tabId;
    return ensurePlaybackScripts(tabId).catch((error) => ({ ok: false, error: error.message }));
});

async function activateOpenPlaybackTabs() {
    const tabs = await browser.tabs.query({});
    await Promise.allSettled(tabs
        .filter((tab) => Number.isInteger(tab.id) && isPlaybackURL(tab.url))
        .map((tab) => ensurePlaybackScripts(tab.id)));
}

if (browser.runtime.onStartup?.addListener) {
    browser.runtime.onStartup.addListener(() => {
        void activateOpenPlaybackTabs().catch(() => {});
    });
}
