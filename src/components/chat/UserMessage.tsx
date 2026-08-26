interface UserMessageProps {
  text: string;
}

/** The user's chat turn — styled like a pinned note, not a rounded bubble
 * (see decisions.md 2026-08-27: "Property Dossier" direction). */
export function UserMessage({ text }: UserMessageProps) {
  return (
    <div className="user-message">
      <p>{text}</p>
    </div>
  );
}
