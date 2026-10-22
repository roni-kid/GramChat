import { useState } from "react";
import { AtSign, Check, Clock, Loader2, Search, UserCheck, UserPlus, X } from "lucide-react";
import { useContactStore } from "../store/useContactStore";

const Avatar = ({ user }) => <img src={user.profilePic || "/avatar.png"} alt="" className="size-10 rounded-full object-cover shrink-0" />;

const Row = ({ user, children }) => (
  <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200">
    <Avatar user={user} />
    <div className="min-w-0 flex-1">
      <div className="font-medium truncate">{user.fullName}</div>
      <div className="text-sm text-base-content/50 truncate">@{user.username}</div>
    </div>
    {children}
  </div>
);

const ContactsModal = ({ onClose, initialTab = "add" }) => {
  const { incoming, outgoing, blocked, search, sendRequest, accept, remove, unblock } = useContactStore();
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(undefined); // undefined = nothing searched, null = not found
  const [busy, setBusy] = useState(false);

  const doSearch = async (e) => {
    e.preventDefault();
    const q = query.trim().replace(/^@/, "");
    if (!q) return;
    setBusy(true);
    setResult(await search(q));
    setBusy(false);
  };

  const act = async (fn, id) => {
    await fn(id);
    if (result) setResult(await search(result.username)); // refresh the card's state
  };

  const tabBtn = (id, label, count) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 ${tab === id ? "border-b-2 border-primary text-primary" : "text-base-content/60"}`}
    >
      {label}
      {count > 0 && <span className="badge badge-primary badge-xs">{count}</span>}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-base-100 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 pb-2">
          <h2 className="font-semibold text-lg">Contacts</h2>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}><X className="size-4" /></button>
        </div>
        <div className="flex border-b border-base-300">
          {tabBtn("add", "Add", 0)}
          {tabBtn("requests", "Requests", incoming.length)}
          {tabBtn("blocked", "Blocked", 0)}
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {tab === "add" && (
            <div className="space-y-4">
              <form onSubmit={doSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-base-content/40" />
                  <input
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setResult(undefined); }}
                    placeholder="Enter their exact username"
                    className="input input-bordered w-full pl-9"
                  />
                </div>
                <button className="btn btn-primary" disabled={busy || !query.trim()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                </button>
              </form>
              <p className="text-xs text-base-content/50">
                People can only be found by their exact username, so ask your friend for theirs (it's on their Profile page).
              </p>

              {result === null && <p className="text-center text-sm text-base-content/60 py-4">No one found with that username.</p>}
              {result && (
                <Row user={result}>
                  {result.relation === "none" && (
                    <button className="btn btn-primary btn-sm gap-1" onClick={() => act(sendRequest, result._id)}><UserPlus className="size-4" /> Add</button>
                  )}
                  {result.relation === "pending_out" && <span className="text-sm text-base-content/50 flex items-center gap-1"><Clock className="size-4" /> Requested</span>}
                  {result.relation === "pending_in" && (
                    <button className="btn btn-primary btn-sm gap-1" onClick={() => act(accept, result._id)}><Check className="size-4" /> Accept</button>
                  )}
                  {result.relation === "contact" && <span className="text-sm text-success flex items-center gap-1"><UserCheck className="size-4" /> Contact</span>}
                  {result.relation === "blocked" && (
                    <button className="btn btn-outline btn-sm" onClick={() => act(unblock, result._id)}>Unblock</button>
                  )}
                </Row>
              )}
            </div>
          )}

          {tab === "requests" && (
            <div className="space-y-4">
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-1">Wants to connect</h3>
                {incoming.length === 0 && <p className="text-sm text-base-content/50 py-2">No requests right now.</p>}
                {incoming.map((u) => (
                  <Row key={u._id} user={u}>
                    <button className="btn btn-primary btn-xs" onClick={() => accept(u._id)}>Accept</button>
                    <button className="btn btn-ghost btn-xs" onClick={() => remove(u._id)}>Decline</button>
                  </Row>
                ))}
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-1">Sent by you</h3>
                {outgoing.length === 0 && <p className="text-sm text-base-content/50 py-2">Nothing pending.</p>}
                {outgoing.map((u) => (
                  <Row key={u._id} user={u}>
                    <button className="btn btn-ghost btn-xs" onClick={() => remove(u._id)}>Cancel</button>
                  </Row>
                ))}
              </section>
            </div>
          )}

          {tab === "blocked" && (
            <div>
              {blocked.length === 0 && <p className="text-sm text-base-content/50 py-2">You haven't blocked anyone.</p>}
              {blocked.map((u) => (
                <Row key={u._id} user={u}>
                  <button className="btn btn-outline btn-xs" onClick={() => unblock(u._id)}>Unblock</button>
                </Row>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContactsModal;
