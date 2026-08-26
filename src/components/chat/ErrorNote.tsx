interface ErrorNoteProps {
  message: string;
}

/** Honest failure state — PRD.md §8: say what went wrong plainly, never
 * fabricate a result or hide behind a generic "something went wrong." */
export function ErrorNote({ message }: ErrorNoteProps) {
  return (
    <div className="error-note" role="alert">
      <p>{message}</p>
    </div>
  );
}
