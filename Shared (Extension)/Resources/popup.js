const STORAGE_KEY = "dualSubtitlesEnabled";
const REVISION_KEY = "dualSubtitlesRevision";

function setStatus(message, isError = false) {
    const status = document.getElementById("toggle-status");
    status.textContent = message;
    status.classList.toggle("error", isError);
}

async function notifyActiveTab(enabled, revision) {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return false;
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

async function loadSetting() {
    const checkbox = document.getElementById("dual-subtitles-enabled");
    try {
        const stored = await browser.storage.local.get(STORAGE_KEY);
        checkbox.checked = stored[STORAGE_KEY] === true;
        checkbox.disabled = false;
        setStatus(checkbox.checked ? "已啟用" : "已關閉");
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
    checkbox.disabled = true;
    setStatus("正在套用…");
    try {
        const revision = Date.now();
        await browser.storage.local.set({ [STORAGE_KEY]: enabled, [REVISION_KEY]: revision });
        const verified = await browser.storage.local.get([STORAGE_KEY, REVISION_KEY]);
        if (verified[STORAGE_KEY] !== enabled || verified[REVISION_KEY] !== revision) throw new Error("Stored value did not match");
        const delivered = await notifyActiveTab(enabled, revision);
        if (delivered?.ok === true && delivered.enabled === enabled) {
            setStatus(enabled ? "已啟用，網站原生字幕已暫停" : "已關閉，網站原生字幕已恢復");
        } else if (delivered) {
            setStatus(delivered.error || "字幕狀態切換失敗", true);
        } else {
            setStatus(enabled ? "已儲存；請重新載入播放頁面" : "已儲存；播放分頁未連線");
        }
    } catch (error) {
        console.error("Unable to save dual subtitle setting", error);
        const stored = await browser.storage.local.get(STORAGE_KEY).catch(() => ({}));
        checkbox.checked = stored[STORAGE_KEY] === true;
        setStatus("無法儲存設定", true);
    } finally {
        checkbox.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const checkbox = document.getElementById("dual-subtitles-enabled");
    checkbox.addEventListener("change", saveSetting);
    void loadSetting();
});
