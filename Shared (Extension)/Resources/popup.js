const STORAGE_KEY = "dualSubtitlesEnabled";
const REVISION_KEY = "dualSubtitlesRevision";
const PLAYBACK_URL_PATTERN = /^https:\/\/www\.netflix\.com\/watch\//;
let latestUIRevision = 0;

function setStatus(message, isError = false) {
    const status = document.getElementById("toggle-status");
    status.textContent = message;
    status.classList.toggle("error", isError);
}

async function activePlaybackTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !PLAYBACK_URL_PATTERN.test(tab.url || "")) return null;
    return tab;
}

async function notifyTab(tab, enabled, revision) {
    try {
        const response = await browser.tabs.sendMessage(tab.id, {
            type: "set-dual-subtitles-enabled",
            enabled,
            revision
        });
        return response || false;
    } catch {
        return false;
    }
}

async function ensureContentScripts(tab) {
    const response = await browser.runtime.sendMessage({
        type: "ensure-playback-scripts",
        tabId: tab.id
    });
    if (response?.ok !== true) throw new Error(response?.error || "無法啟動播放頁面程式");
}

async function notifyActiveTab(enabled, revision) {
    const tab = await activePlaybackTab();
    if (!tab) return { connected: false, reason: "not-playback-page" };

    let response = await notifyTab(tab, enabled, revision);
    if (response) return { connected: true, response };

    try {
        await ensureContentScripts(tab);
    } catch (error) {
        return { connected: false, reason: "injection-failed", error: error.message };
    }
    response = await notifyTab(tab, enabled, revision);
    return { connected: response !== false, response };
}

function showDeliveryStatus(delivery, enabled, passive = false) {
    const delivered = delivery.response;
    if (delivered?.ok === true && delivered.enabled === enabled) {
        setStatus(enabled ? "已啟用，網站原生字幕已暫停" : "已關閉，網站原生字幕已恢復");
    } else if (delivered) {
        setStatus(delivered.error || "字幕狀態切換失敗", true);
    } else if (delivery.reason === "not-playback-page") {
        if (!enabled) setStatus("已關閉");
        else setStatus(passive ? "已啟用；開啟 Netflix 播放頁面後套用" : "請先開啟 Netflix 播放頁面", !passive);
    } else if (delivery.reason === "injection-failed") {
        setStatus(delivery.error || "無法啟動播放頁面程式", true);
    } else {
        setStatus("無法連接播放頁面，請確認網站存取權限", true);
    }
}

async function synchronizeStoredEnable(revision) {
    const delivery = await notifyActiveTab(true, revision);
    if (revision !== latestUIRevision) return;
    showDeliveryStatus(delivery, true, true);
}

async function loadSetting() {
    const checkbox = document.getElementById("dual-subtitles-enabled");
    try {
        const stored = await browser.storage.local.get([STORAGE_KEY, REVISION_KEY]);
        const revision = Number(stored[REVISION_KEY]) || 0;
        latestUIRevision = revision;
        checkbox.checked = stored[STORAGE_KEY] === true;
        checkbox.disabled = false;
        if (checkbox.checked) {
            setStatus("正在恢復雙語字幕…");
            void synchronizeStoredEnable(revision);
        } else {
            setStatus("已關閉");
        }
    } catch (error) {
        console.error("Unable to load dual subtitle setting", error);
        checkbox.checked = false;
        checkbox.disabled = true;
        setStatus("無法讀取設定", true);
    }
}

async function saveSetting(event) {
    const checkbox = event.currentTarget;
    const enabled = checkbox.checked;
    const revision = Date.now();
    latestUIRevision = revision;
    checkbox.disabled = true;
    setStatus("正在套用…");
    try {
        await browser.storage.local.set({ [STORAGE_KEY]: enabled, [REVISION_KEY]: revision });
        const verified = await browser.storage.local.get([STORAGE_KEY, REVISION_KEY]);
        if (verified[STORAGE_KEY] !== enabled || verified[REVISION_KEY] !== revision) throw new Error("Stored value did not match");
        const delivery = await notifyActiveTab(enabled, revision);
        if (revision === latestUIRevision) showDeliveryStatus(delivery, enabled);
    } catch (error) {
        console.error("Unable to save dual subtitle setting", error);
        const stored = await browser.storage.local.get(STORAGE_KEY).catch(() => ({}));
        if (revision === latestUIRevision) {
            checkbox.checked = stored[STORAGE_KEY] === true;
            setStatus("無法儲存設定", true);
        }
    } finally {
        if (revision === latestUIRevision) checkbox.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const checkbox = document.getElementById("dual-subtitles-enabled");
    checkbox.addEventListener("change", saveSetting);
    void loadSetting();
});
