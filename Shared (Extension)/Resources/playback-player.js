(() => {
    "use strict";

    function textTrackSnapshot(video) {
        return Array.from(video.textTracks || []).map((track) => ({
            label: track.label || "",
            language: track.language || "",
            kind: track.kind || "",
            mode: track.mode || "",
            cueCount: track.cues ? track.cues.length : null,
            cues: track.cues ? Array.from(track.cues).map((cue) => ({ start: cue.startTime, end: cue.endTime, text: cue.text })) : []
        }));
    }

    window.PlaybackPlayerProbe = {
        start(callbacks) {
            let lastTrackSignature = "";

            const probe = () => {
                const video = document.querySelector("video");
                if (!video) return;
                const snapshot = {
                    currentTime: video.currentTime,
                    duration: video.duration,
                    paused: video.paused
                };
                callbacks.onVideo(video, snapshot);

                const tracks = textTrackSnapshot(video);
                const signature = JSON.stringify(tracks.map(({ label, language, kind, mode, cueCount }) => ({ label, language, kind, mode, cueCount })));
                if (signature !== lastTrackSignature) {
                    lastTrackSignature = signature;
                    callbacks.onTextTracks(tracks);
                }
            };

            probe();
            setInterval(probe, 1000);
        }
    };
})();
