import { X, Mail, User, Info } from "lucide-react";

const UserProfileModal = ({ user, isOnline, onClose }) => {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Modal card */}
        <div
          className="bg-base-100 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Banner */}
          <div className="h-24 bg-gradient-to-r from-primary/30 to-primary/10 relative">
            <button
              className="absolute top-3 right-3 btn btn-ghost btn-sm btn-circle"
              onClick={onClose}
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Avatar — overlapping banner */}
          <div className="px-6 pb-6">
            <div className="flex items-end gap-4 -mt-10 mb-4">
              <div className="relative">
                <img
                  src={user.profilePic || "/avatar.png"}
                  alt={user.fullName}
                  className="size-20 rounded-full object-cover border-4 border-base-100 shadow-md"
                />
                {/* Online dot */}
                <span
                  className={`absolute bottom-1 right-1 size-4 rounded-full border-2 border-base-100 ${
                    isOnline ? "bg-green-500" : "bg-base-300"
                  }`}
                />
              </div>
              <div className="pb-1">
                <h2 className="text-xl font-bold">{user.fullName}</h2>
                <p className={`text-sm font-medium ${isOnline ? "text-green-500" : "text-base-content/50"}`}>
                  {isOnline ? "● Online" : "○ Offline"}
                </p>
              </div>
            </div>

            {/* Info rows */}
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-base-200 rounded-xl">
                <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <User className="size-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-base-content/50 mb-0.5">Full Name</p>
                  <p className="font-medium truncate">{user.fullName}</p>
                </div>
              </div>

              {user.email && (
                <div className="flex items-center gap-3 p-3 bg-base-200 rounded-xl">
                  <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Mail className="size-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-base-content/50 mb-0.5">Email</p>
                    <p className="font-medium truncate">{user.email}</p>
                  </div>
                </div>
              )}

              {/* About / Bio placeholder — future feature */}
              <div className="flex items-center gap-3 p-3 bg-base-200 rounded-xl">
                <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Info className="size-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-base-content/50 mb-0.5">Status</p>
                  <p className="font-medium text-base-content/70">Hey there! I am using Gramchat 👋</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default UserProfileModal;
