(() => {
    "use strict";

    const clean = (value) => String(value || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim();

    function clock(value, timing = {}) {
        if (typeof value === "number") return value;
        const input = String(value || "").trim();
        const ticks = input.match(/^(\d+(?:\.\d+)?)t$/);
        if (ticks) return timing.tickRate ? Number(ticks[1]) / timing.tickRate : NaN;
        if (/^\d+(?:\.\d+)?(?:ms|s|m|h)$/.test(input)) {
            const number = parseFloat(input);
            if (input.endsWith("ms")) return number / 1000;
            if (input.endsWith("m")) return number * 60;
            if (input.endsWith("h")) return number * 3600;
            return number;
        }
        const match = input.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d+))?$/);
        if (!match) {
            const frames = input.match(/^(\d+):(\d{2}):(\d{2}):(\d+)$/);
            if (!frames || !timing.frameRate) return NaN;
            return Number(frames[1]) * 3600 + Number(frames[2]) * 60 + Number(frames[3]) + Number(frames[4]) / timing.frameRate;
        }
        const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
        return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + fraction;
    }

    function normalize(cues) {
        return cues.map((cue) => ({ start: Number(cue.start), end: Number(cue.end), text: clean(cue.text) }))
            .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end >= cue.start && cue.text);
    }

    function webvtt(text) {
        const blocks = text.replace(/^\uFEFF/, "").split(/\r?\n\s*\r?\n/);
        const cues = [];
        for (const block of blocks) {
            const lines = block.split(/\r?\n/);
            const timingIndex = lines.findIndex((line) => line.includes("-->"));
            if (timingIndex < 0) continue;
            const [rawStart, rawEnd] = lines[timingIndex].split("-->");
            cues.push({
                start: clock(rawStart.trim()),
                end: clock(rawEnd.trim().split(/\s+/)[0]),
                text: lines.slice(timingIndex + 1).join("\n")
            });
        }
        return normalize(cues);
    }

    function ttml(text) {
        const xml = new DOMParser().parseFromString(text, "application/xml");
        if (xml.querySelector("parsererror")) return [];
        const root = xml.documentElement;
        const timing = {
            frameRate: Number(root.getAttribute("ttp:frameRate") || root.getAttribute("frameRate") || 0),
            tickRate: Number(root.getAttribute("ttp:tickRate") || root.getAttribute("tickRate") || 0)
        };
        const cues = [];
        const paragraphs = Array.from(xml.getElementsByTagNameNS("*", "p"));
        for (const node of paragraphs) {
            const begin = clock(node.getAttribute("begin"), timing);
            const rawEnd = node.getAttribute("end");
            const duration = clock(node.getAttribute("dur"), timing);
            cues.push({ start: begin, end: rawEnd ? clock(rawEnd, timing) : begin + duration, text: node.textContent });
        }
        return normalize(cues);
    }

    function json(value) {
        const seen = new Set();
        const cues = [];
        function visit(node) {
            if (!node || typeof node !== "object" || seen.has(node)) return;
            seen.add(node);
            const usesMilliseconds = node.t != null;
            const start = node.start ?? node.begin ?? node.startTime ?? (usesMilliseconds ? Number(node.t) / 1000 : undefined);
            const end = node.end ?? node.endTime ?? (usesMilliseconds && node.d != null ? (Number(node.t) + Number(node.d)) / 1000 : undefined) ?? (node.duration != null ? Number(start) + Number(node.duration) : undefined);
            const text = node.text ?? node.payload ?? node.content ?? node.line;
            if (start != null && end != null && typeof text === "string") cues.push({ start: clock(start), end: clock(end), text });
            for (const child of Object.values(node)) visit(child);
        }
        visit(value);
        return normalize(cues);
    }

    window.DualSubtitleParser = {
        parse(body, hint = "") {
            const trimmed = String(body || "").trim();
            if (!trimmed) return [];
            if (/WEBVTT/i.test(trimmed.slice(0, 100)) || /\.vtt(?:\?|$)/i.test(hint)) return webvtt(trimmed);
            if (trimmed.startsWith("<") || /(?:ttml|dfxp|\.xml)/i.test(hint)) return ttml(trimmed);
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                try { return json(JSON.parse(trimmed)); } catch { return []; }
            }
            return [];
        },
        clock
    };
})();
