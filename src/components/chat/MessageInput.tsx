"use client";

import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import type { AddressSuggestion } from "@/lib/photon";
import { useAddressAutocomplete } from "./useAddressAutocomplete";

interface MessageInputProps {
  onSend: (message: string, deepResearch: boolean) => void;
  disabled: boolean;
}

/**
 * The chat input, plus free US address autocomplete-as-you-type (Ticket
 * 10, via Photon — see decisions.md). A UI convenience only: picking a
 * suggestion just fills the textarea with a cleaner address string: the
 * real geocode still runs through the existing pipeline unchanged once the
 * user hits Research. Built as a WAI-ARIA combobox so it's usable via
 * keyboard alone, not just the mouse.
 */
export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [text, setText] = useState("");
  const [deepResearch, setDeepResearch] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [rawActiveIndex, setActiveIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useAddressAutocomplete(text, !disabled);
  const isDropdownVisible = !dismissed && !disabled && suggestions.length > 0;
  // Clamped defensively, but the real reset happens in handleChange on every
  // keystroke (not here) — a same-length or longer refreshed suggestion list
  // would otherwise leave a stale index silently highlighting an unrelated
  // address once the debounced fetch resolves 250ms later, since nothing
  // about *this* expression changes when the list is replaced rather than
  // shortened. Caught in code review before this shipped.
  const activeIndex = rawActiveIndex < suggestions.length ? rawActiveIndex : -1;

  function selectSuggestion(suggestion: AddressSuggestion) {
    setText(suggestion.label);
    setDismissed(true);
    setActiveIndex(-1);
    textareaRef.current?.focus();
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, deepResearch);
    setText("");
    setDismissed(false);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value);
    setDismissed(false);
    // The debounced suggestion list for this new text won't arrive for
    // another 250ms — reset now rather than waiting on it, so a stale index
    // never ends up highlighting whatever happens to occupy that same slot
    // in the next, unrelated list.
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isDropdownVisible) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex(Math.min(activeIndex + 1, suggestions.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(Math.max(activeIndex - 1, 0));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && activeIndex >= 0) {
        event.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const activeSuggestionId =
    activeIndex >= 0 && suggestions[activeIndex] ? `address-suggestion-${suggestions[activeIndex].id}` : undefined;

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
        <div className="address-combobox">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setDismissed(true)}
            placeholder="Paste a US address…"
            rows={1}
            disabled={disabled}
            aria-label="Address or message"
            role="combobox"
            aria-expanded={isDropdownVisible}
            aria-controls="address-suggestion-list"
            aria-autocomplete="list"
            aria-activedescendant={activeSuggestionId}
          />
          {isDropdownVisible && (
            <ul className="address-combobox__list" role="listbox" id="address-suggestion-list">
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={`address-suggestion-${suggestion.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className="address-combobox__option"
                  data-active={index === activeIndex}
                  // onMouseDown (not onClick) fires before the textarea's
                  // blur, and preventDefault keeps focus in the textarea —
                  // otherwise blur would dismiss the list before the click
                  // ever registers.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectSuggestion(suggestion);
                  }}
                >
                  {suggestion.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" disabled={disabled || !text.trim()}>
          Research
        </button>
      </div>
    </form>
  );
}
