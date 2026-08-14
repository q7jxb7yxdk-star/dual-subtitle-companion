function postToHost(message) {
    window.webkit?.messageHandlers?.controller?.postMessage(message);
}

function show(platform, enabled, useSettingsInsteadOfPreferences) {
    document.body.classList.add(`platform-${platform}`);

    if (useSettingsInsteadOfPreferences) {
        document.querySelector(".platform-mac.open-preferences").innerText = "Quit and Open Safari Settings…";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on");
        document.body.classList.remove("state-off");
    }
}

function showError(message) {
    const element = document.getElementById("error-message");
    const text = typeof message === "string" ? message.trim() : "";
    element.textContent = text;
    element.hidden = !text;
}

function clearError() {
    showError("");
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("button.open-preferences")?.addEventListener("click", () => {
        clearError();
        postToHost({ action: "open-preferences" });
    });

    for (const button of document.querySelectorAll("button[data-external-url]")) {
        button.addEventListener("click", () => {
            clearError();
            postToHost({ action: "open-url", url: button.dataset.externalUrl });
        });
    }
});
