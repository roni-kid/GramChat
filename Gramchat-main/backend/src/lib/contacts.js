import Message from "../models/message.model.js";
import Group from "../models/group.model.js";

/** People you have a relationship with: anyone you've exchanged DMs with or share a group with. */
export const getContactIds = async (userId) => {
  const id = userId.toString();
  const [sentTo, receivedFrom, groups] = await Promise.all([
    Message.distinct("receiverId", { senderId: userId, groupId: null }),
    Message.distinct("senderId", { receiverId: userId }),
    Group.find({ members: userId }).select("members").lean(),
  ]);
  const set = new Set([...sentTo, ...receivedFrom].filter(Boolean).map(String));
  groups.forEach((g) => g.members.forEach((m) => set.add(m.toString())));
  set.delete(id);
  return set;
};
