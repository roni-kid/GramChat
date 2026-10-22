import { useState } from "react";
import { createPortal } from "react-dom";
import { Timer, X } from "lucide-react";
import { TIMER_CHOICES, timerLabel } from "../lib/messageRules";

/** Picks how long NEW messages in a chat live before the server deletes them for everyone.
 *  onPick(seconds) must return a promise that resolves true when the change was saved. canChange=false shows it read-only (group members). */
const DisappearingModal = ({ title, current = 0, canChange = true, who = "Either of you can change this.", onPick, onClose }) => {
  const [saving, setSaving] = useState(false);

  const pick = async (seconds) => {
    if (!canChange || saving || seconds === current) return;
    setSaving(true);
    const ok = await onPick(seconds);
    setSaving(false);
    if (ok) onClose();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-base-100 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Disappearing messages">
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
          <div className="min-w-0">
            <h2 className="font-semibold text-lg flex items-center gap-2"><Timer className="size-5 text-primary" /> Disappearing messages</h2>
            {title && <p className="text-xs text-base-content/50 truncate">{title}</p>}
          </div>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm text-base-content/70">
            New messages in this chat are deleted for everyone after the time you choose. Messages already sent are not affected.
          </p>
          <div className="space-y-1" role="radiogroup" aria-label="Disappear after">
            {TIMER_CHOICES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={current === s}
                disabled={!canChange || saving}
                onClick={() => pick(s)}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-colors ${current === s ? "bg-primary/10 border border-primary/30" : "hover:bg-base-200 border border-transparent"} disabled:opacity-60`}
              >
                <span className={`size-4 rounded-full border-2 shrink-0 ${current === s ? "border-primary bg-primary" : "border-base-content/30"}`} />
                <span className="text-sm font-medium">{timerLabel(s)}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-base-content/50">
            {canChange ? who : "Only the group admin can change this."} Anyone in the chat can still copy or screenshot a message before it disappears.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DisappearingModal;
