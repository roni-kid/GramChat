import { useChatStore } from "../store/useChatStore";
import { useGroupStore } from "../store/useGroupStore";
import Sidebar from "../components/Sidebar";
import MobileHome from "../components/MobileHome";
import NoChatSelected from "../components/NoChatSelected";
import ChatContainer from "../components/ChatContainer";
import GroupChatContainer from "../components/GroupChatContainer";
import { useIsDesktop } from "../lib/useMediaQuery";

const HomePage = () => {
  const { selectedUser } = useChatStore();
  const { selectedGroup } = useGroupStore();
  const hasSelection = selectedUser || selectedGroup;
  const isDesktop = useIsDesktop();

  return (
    // Phone: the app fills the whole screen. Desktop (lg and up): the same framed card as always.
    <div className="h-dvh lg:h-screen bg-base-200">
      <div className="h-full lg:h-auto lg:flex items-center justify-center lg:pt-20 lg:px-4">
        <div className="bg-base-100 lg:rounded-lg lg:shadow-cl w-full lg:max-w-6xl h-full lg:h-[calc(100vh-8rem)]">
          <div className="flex h-full lg:rounded-lg overflow-hidden">
            {isDesktop ? (
              <>
                <div className="block">
                  <Sidebar />
                </div>

                {/* Main panel */}
                {!hasSelection ? (
                  <div className="flex flex-1">
                    <NoChatSelected />
                  </div>
                ) : selectedUser ? (
                  <ChatContainer />
                ) : (
                  <GroupChatContainer />
                )}
              </>
            ) : !hasSelection ? (
              // Phone, no chat open: the new home screen
              <MobileHome />
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
