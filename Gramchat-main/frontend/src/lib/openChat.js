import { useChatStore } from "../store/useChatStore";
import { useGroupStore } from "../store/useGroupStore";

/** Opens a chat from a notification tap or a search result. kind: "dm" (chatId = the other person's id) or "group" (chatId = group id).
 *  Returns true when the chat is open afterwards, false when it can't be found (removed contact, left group). */
export async function openChat(kind, chatId) {
  if (typeof chatId !== "string") return false;
  if (kind === "dm") {
    if (useChatStore.getState().selectedUser?._id === chatId) return true; // already open: re-selecting would reset it
    if (!useChatStore.getState().users.length) await useChatStore.getState().getUsers();
    const user = useChatStore.getState().users.find((u) => u._id === chatId);
    if (!user) return false;
    useGroupStore.getState().setSelectedGroup(null);
    useChatStore.getState().setSelectedUser(user);
    return true;
  }
  if (kind === "group") {
    if (useGroupStore.getState().selectedGroup?._id === chatId) return true;
    if (!useGroupStore.getState().groups.length) await useGroupStore.getState().getMyGroups();
    const group = useGroupStore.getState().groups.find((g) => g._id === chatId);
    if (!group) return false;
    useChatStore.getState().setSelectedUser(null);
    useGroupStore.getState().setSelectedGroup(group);
    return true;
  }
  return false;
}

/** Opens a chat and scrolls to one message in it ({ id, createdAt }), loading older messages first if it is far back. */
export async function openChatAt(kind, chatId, message) {
  if (!(await openChat(kind, chatId))) return false;
  if (message?.id) (kind === "dm" ? useChatStore : useGroupStore).getState().setFocus({ id: message.id, createdAt: message.createdAt });
  return true;
}
