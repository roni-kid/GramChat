import { useEffect } from "react";
import { useTranscriptStore } from "../store/useTranscriptStore";

/** Settings section: transcripts of voice notes, made on this device (Phase 2F). */
const TranscriptSettings = () => {
  const available = useTranscriptStore((s) => s.available);
  const model = useTranscriptStore((s) => s.model);
  const enabled = useTranscriptStore((s) => s.enabled);
  const { init, setEnabled } = useTranscriptStore.getState();

  useEffect(() => { init(); }, [init]);

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Voice-note transcripts</h2>
        <p className="text-sm text-base-content/70">
          Turn a voice note into text. It is done by a speech model running inside this browser: the audio is never sent anywhere,
          and the text stays on this device only.
        </p>
      </div>
      <div className="rounded-xl border border-base-300 divide-y divide-base-300">
        <label className={`flex items-center justify-between gap-4 p-4 ${available ? "cursor-pointer" : "opacity-70"}`}>
          <div>
            <div className="font-medium">Show a “Transcribe” button on voice notes</div>
            <div className="text-sm text-base-content/60">
              {available === null && "Checking whether this server has the speech model…"}
              {available === true && <>The first time, your browser loads the speech model from this server (about 40 to 80 MB, kept by the browser). Transcripts can be wrong, especially with noise or strong accents.</>}
              {available === false && (
                <>
                  Not available here. The server owner needs to run <code className="text-xs">npm run setup:transcripts</code>, rebuild the app and restart
                  it (see CHANGELOG). It also needs a recent browser.
                </>
              )}
            </div>
            {available && model && <div className="text-xs text-base-content/50 mt-1">Model: {model}</div>}
          </div>
          <input type="checkbox" className="toggle toggle-primary" disabled={!available} checked={!!available && enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </label>
      </div>
    </section>
  );
};

export default TranscriptSettings;
