import type { Metadata } from "next";
import { ChatView } from "@/components/chat-view";

export const metadata: Metadata = {
  title: "Chat · Finder",
  description:
    "Ask about a code or a symptom, then follow up. Each answer comes from one model's manual; earlier questions carry over, earlier answers never count as evidence.",
};

export default function Page() {
  return <ChatView />;
}
