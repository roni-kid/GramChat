import { useState } from "react";
import { Pin, X } from "lucide-react";
import { previewOf } from "../lib/utils";

/** Strip under the chat header showing the pinned messages (max 3). Clicking jumps to the message and moves on to the next pin. */
const PinnedBar = ({ pinned, onJump, onUnpin }) => {
  const [i, setI] = useState(0);
  if (!pinned.length) return null;
  const idx = Math.min(i, pinned.length - 1);
  const m = pinned[idx];

  return (
    <div className="border-b border-base-300 bg-base-200/60 px-4 py-1.5 flex items-center gap-2">
      <Pin className="size-3.5 text-primary shrink-0" />
      <button type="button" className="flex-1 min-w-0 text-left" onClick={() => { onJump(m._id); setI((idx + 1) % pinned.length); }}>
        <span className="text-xs text-primary font-medium">Pinned{pinned.length > 1 ? ` · ${idx + 1} of ${pinned.length}` : ""}</span>
        <span className="block text-sm truncate text-base-content/70">{previewOf(m)}</span>
      </button>
      <button type="button" className="btn btn-ghost btn-xs btn-circle" title="Unpin" aria-label="Unpin message" onClick={() => onUnpin(m._id)}>
        <X className="size-3" />
      </button>
    </div>
  );
};

export default PinnedBar;
