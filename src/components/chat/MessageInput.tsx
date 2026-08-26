"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

interface MessageInputProps {
  onSend: (message: string, deepResearch: boolean) => void;
  disabled: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [text, setText] = useState("");
  const [deepResearch, setDeepResearch] = useState(false);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, deepResearch);
    setText("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <label className="deep-research-toggle">
        <input
          type="checkbox"
          checked={deepResearch}
          onChange={(event) => setDeepResearch(event.target.checked)}
          disabled={disabled}
        />
        <span className="deep-research-toggle__track" aria-hidden="true">
          <span className="deep-research-toggle__thumb" />
        </span>
        <span className="deep-research-toggle__copy">
          <span className="deep-research-toggle__title">Deep research</span>
          <small>Slower, more thorough on mortgagee/owner — up to ~5 min</small>
        </span>
      </label>

      <div className="message-input__row">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste a US address…"
          rows={1}
          disabled={disabled}
          aria-label="Address or message"
        />
        <button type="submit" disabled={disabled || !text.trim()}>
          Research
        </button>
      </div>
    </form>
  );
}
