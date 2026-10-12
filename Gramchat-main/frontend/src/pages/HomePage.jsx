import { useChatStore } from "../store/useChatStore";
import { useGroupStore } from "../store/useGroupStore";
import Sidebar from "../components/Sidebar";
import NoChatSelected from "../components/NoChatSelected";
import ChatContainer from "../components/ChatContainer";
import GroupChatContainer from "../components/GroupChatContainer";

const HomePage = () => {
  const { selectedUser } = useChatStore();
  const { selectedGroup } = useGroupStore();
  const hasSelection = selectedUser || selectedGroup;

  return (
    <div className="h-screen bg-base-200">
      <div className="flex items-center justify-center pt-20 px-4">
        <div className="bg-base-100 rounded-lg shadow-cl w-full max-w-6xl h-[calc(100vh-8rem)]">
          <div className="flex h-full rounded-lg overflow-hidden">
            {/* Sidebar: full width on mobile when no chat selected */}
            <div className={hasSelection ? "hidden lg:block" : "block w-full lg:w-auto"}>
              <Sidebar />
            </div>

            {/* Main panel */}
            {!hasSelection ? (
              <div className="hidden lg:flex flex-1">
                <NoChatSelected />
              </div>
            ) : selectedUser ? (
              <ChatContainer />
            ) : (
              <GroupChatContainer />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
export default HomePage;
