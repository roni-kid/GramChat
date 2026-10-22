import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getPushStatus, enablePush, disablePush, setPushPreview, sendTestPush } from "../lib/pushClient";

/** Settings → Notifications: turn push on/off for THIS device, choose whether the text is shown, send a test. */
const NotificationSettings = () => {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setS(await getPushStatus()), []);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || "Something went wrong");
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const toggle = (on) => run(() => (on ? enablePush(s?.preview) : disablePush()));
  const togglePreview = (on) => run(() => setPushPreview(on));
  const test = () => run(async () => { await sendTestPush(); toast.success("Test sent: it should appear in a moment"); });

  let hint = null;
  if (s) {
    if (s.needsInstall) hint = "On iPhone and iPad, notifications only work after you add Gramchat to your Home Screen (Share → Add to Home Screen) and open it from there.";
    else if (!s.secure) hint = "Notifications need a secure connection. Open Gramchat through its https link (npm run share) instead of http://.";
    else if (!s.supported) hint = "This browser doesn't support push notifications.";
    else if (s.permission === "denied") hint = "Notifications are blocked for this site. Allow them in your browser's site settings, then come back.";
  }
  const usable = s && !hint;

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-base-content/70">Get a notification for new messages when Gramchat isn't open. This is per device and can be turned off any time.</p>
      </div>
      <div className="rounded-xl border border-base-300 divide-y divide-base-300">
        {hint && <div className="p-4 text-sm text-warning">{hint}</div>}
        <label className={`flex items-center justify-between gap-4 p-4 ${usable ? "cursor-pointer" : "opacity-50"}`}>
          <div>
            <div className="font-medium">Notifications on this device</div>
            <div className="text-sm text-base-content/60">{s?.subscribed ? "On" : "Off"}. Logging out turns them off for this device.</div>
          </div>
          <input type="checkbox" className="toggle toggle-primary" disabled={!usable || busy} checked={!!s?.subscribed} onChange={(e) => toggle(e.target.checked)} />
        </label>
        <label className={`flex items-center justify-between gap-4 p-4 ${usable && s?.subscribed ? "cursor-pointer" : "opacity-50"}`}>
          <div>
            <div className="font-medium">Show message text in notifications</div>
            <div className="text-sm text-base-content/60">Off: you only see who wrote ("New message"). Text on a lock screen can be read by anyone nearby.</div>
          </div>
          <input type="checkbox" className="toggle toggle-primary" disabled={!usable || !s?.subscribed || busy} checked={!!s?.preview} onChange={(e) => togglePreview(e.target.checked)} />
        </label>
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="text-sm text-base-content/60">Check that notifications reach this device.</div>
          <button className="btn btn-sm btn-outline" disabled={!usable || !s?.subscribed || busy} onClick={test}>Send test</button>
        </div>
      </div>
    </section>
  );
};

export default NotificationSettings;
