"use client";

import { useState } from "react";
import { ErrorNote } from "./ErrorNote";
import { LoadingIndicator } from "./LoadingIndicator";
import { MessageInput } from "./MessageInput";
import { ResultCard } from "./ResultCard";
import { UserMessage } from "./UserMessage";
import type { ApiErrorBody, ResearchResult } from "@/lib/types";
import "./chat.css";

type ThreadEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "agent"; kind: "loading"; deepResearch: boolean }
  | { id: string; role: "agent"; kind: "result"; result: ResearchResult }
  | { id: string; role: "agent"; kind: "error"; message: string };

let nextMessageId = 0;
function newMessageId(): string {
  nextMessageId += 1;
  return `msg-${nextMessageId}`;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

/** Top-level chat state and orchestration. Renders the pipeline's JSON
 * directly (via ResultCard) — this component decides layout, never content
 * (PRD.md §6: no LLM, and no ad hoc client logic, "writes" the card). */
export function ChatInterface() {
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [isSending, setIsSending] = useState(false);

  async function handleSend(message: string, deepResearch: boolean) {
    const userId = newMessageId();
    const loadingId = newMessageId();
    setThread((prev) => [
      ...prev,
      { id: userId, role: "user", text: message },
      { id: loadingId, role: "agent", kind: "loading", deepResearch },
    ]);
    setIsSending(true);

    function resolve(entry: ThreadEntry) {
      setThread((prev) => prev.map((m) => (m.id === loadingId ? entry : m)));
    }

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, deepResearch }),
      });
      const body: unknown = await response.json();

      if (response.ok) {
        resolve({ id: loadingId, role: "agent", kind: "result", result: body as ResearchResult });
      } else {
        const errorMessage = isApiErrorBody(body)
          ? body.error.message
          : "The research service returned an unexpected error.";
        resolve({ id: loadingId, role: "agent", kind: "error", message: errorMessage });
      }
    } catch {
      resolve({
        id: loadingId,
        role: "agent",
        kind: "error",
        message: "Network error — could not reach the research service.",
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="chat-interface">
      <header className="chat-interface__header">
        <p className="chat-interface__eyebrow">Property Research Agent</p>
        <h1>Paste an address. Get a sourced dossier.</h1>
      </header>

      <div className="chat-interface__thread">
        {thread.length === 0 && (
          <p className="chat-interface__empty">No case open yet — paste a US address below to start one.</p>
        )}
        {thread.map((entry) => {
          if (entry.role === "user") return <UserMessage key={entry.id} text={entry.text} />;
          if (entry.kind === "loading") return <LoadingIndicator key={entry.id} deepResearch={entry.deepResearch} />;
          if (entry.kind === "error") return <ErrorNote key={entry.id} message={entry.message} />;
          return <ResultCard key={entry.id} result={entry.result} />;
        })}
      </div>

      <MessageInput onSend={handleSend} disabled={isSending} />
    </div>
  );
}
