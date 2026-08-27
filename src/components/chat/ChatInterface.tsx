"use client";

import { useState } from "react";
import { AgentAnswer } from "./AgentAnswer";
import { ErrorNote } from "./ErrorNote";
import { LoadingIndicator } from "./LoadingIndicator";
import { MessageInput } from "./MessageInput";
import { ResultCard } from "./ResultCard";
import { UserMessage } from "./UserMessage";
import { applyFieldEvent, createPendingFields, resolvedFields, type LiveField } from "./liveField";
import { readSseEvents } from "@/lib/sseClient";
import type { ApiErrorBody, ChatResponse, ResearchResult, ResearchStreamEvent } from "@/lib/types";
import "./chat.css";

type CaseEntry = {
  id: string;
  role: "agent";
  kind: "case";
  address: string;
  fields: LiveField[];
  notices: string[];
  isStreaming: boolean;
  startedAt: number;
  deepResearch: boolean;
};

type ThreadEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "agent"; kind: "loading"; deepResearch: boolean }
  | CaseEntry
  | { id: string; role: "agent"; kind: "answer"; text: string }
  | { id: string; role: "agent"; kind: "error"; message: string };

let nextMessageId = 0;
function newMessageId(): string {
  nextMessageId += 1;
  return `msg-${nextMessageId}`;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

function isCaseEntry(entry: ThreadEntry): entry is CaseEntry {
  return entry.role === "agent" && entry.kind === "case";
}

/** Top-level chat state and orchestration. Renders the pipeline's JSON
 * directly (via ResultCard) — this component decides layout, never content
 * (PRD.md §6: no LLM, and no ad hoc client logic, "writes" the card). Also
 * tracks the most recent successful result so a later message that isn't a
 * new address gets treated as a follow-up question about it (Ticket 7) —
 * there's no server-side session, so this context travels with the request
 * (decisions.md 2026-08-25: no database, stateless per-request).
 *
 * A new address is researched via a Server-Sent Events stream, not a single
 * JSON response (Ticket 9) — requests can take up to several minutes (deep
 * research mode), and a silent multi-minute wait reads as broken. Each of
 * the 9 fields is rendered the moment it individually resolves instead.
 */
export function ChatInterface() {
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [lastResult, setLastResult] = useState<ResearchResult | null>(null);

  async function handleSend(message: string, deepResearch: boolean) {
    const userId = newMessageId();
    const loadingId = newMessageId();
    setThread((prev) => [
      ...prev,
      { id: userId, role: "user", text: message },
      { id: loadingId, role: "agent", kind: "loading", deepResearch },
    ]);
    setIsSending(true);

    function replace(entry: ThreadEntry) {
      setThread((prev) => prev.map((m) => (m.id === loadingId ? entry : m)));
    }

    function patchCase(patch: (entry: CaseEntry) => CaseEntry) {
      setThread((prev) => prev.map((m) => (m.id === loadingId && isCaseEntry(m) ? patch(m) : m)));
    }

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, deepResearch, previousResult: lastResult ?? undefined }),
      });
      const contentType = response.headers.get("Content-Type") ?? "";

      if (!response.ok) {
        const body: unknown = await response.json();
        const errorMessage = isApiErrorBody(body)
          ? body.error.message
          : "The research service returned an unexpected error.";
        replace({ id: loadingId, role: "agent", kind: "error", message: errorMessage });
        return;
      }

      if (contentType.includes("application/json")) {
        // Only a follow-up answer ever comes back this way now — a newly
        // researched address always streams (see below).
        const chatResponse = (await response.json()) as ChatResponse;
        replace({ id: loadingId, role: "agent", kind: "answer", text: chatResponse.answer });
        return;
      }

      if (!response.body) {
        throw new Error("Streaming research response had no body.");
      }

      replace({
        id: loadingId,
        role: "agent",
        kind: "case",
        address: "",
        fields: createPendingFields(),
        notices: [],
        isStreaming: true,
        startedAt: Date.now(),
        deepResearch,
      });

      for await (const raw of readSseEvents(response.body)) {
        const event = JSON.parse(raw) as ResearchStreamEvent;

        if (event.type === "geocode") {
          patchCase((entry) => ({ ...entry, address: event.geocode.matchedAddress }));
        } else if (event.type === "field") {
          patchCase((entry) => ({ ...entry, fields: applyFieldEvent(entry.fields, event.field) }));
        } else if (event.type === "done") {
          setLastResult(event.result);
          patchCase((entry) => ({
            ...entry,
            address: event.result.geocode.matchedAddress,
            fields: resolvedFields(event.result.fields),
            notices: event.result.notices,
            isStreaming: false,
          }));
        } else if (event.type === "error") {
          replace({ id: loadingId, role: "agent", kind: "error", message: event.message });
        }
      }
    } catch {
      replace({
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
          <p className="chat-interface__empty">
            No case open yet — paste a US address below to start one. Once a case is open, you
            can ask follow-up questions about it too.
          </p>
        )}
        {thread.map((entry) => {
          if (entry.role === "user") return <UserMessage key={entry.id} text={entry.text} />;
          if (entry.kind === "loading") return <LoadingIndicator key={entry.id} deepResearch={entry.deepResearch} />;
          if (entry.kind === "error") return <ErrorNote key={entry.id} message={entry.message} />;
          if (entry.kind === "answer") return <AgentAnswer key={entry.id} text={entry.text} />;
          return (
            <ResultCard
              key={entry.id}
              address={entry.address}
              fields={entry.fields}
              notices={entry.notices}
              isStreaming={entry.isStreaming}
              startedAt={entry.startedAt}
              deepResearch={entry.deepResearch}
            />
          );
        })}
      </div>

      <MessageInput onSend={handleSend} disabled={isSending} />
    </div>
  );
}
