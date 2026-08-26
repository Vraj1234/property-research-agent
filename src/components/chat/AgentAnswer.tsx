interface AgentAnswerProps {
  text: string;
}

/** A follow-up answer grounded in an already-fetched result (Ticket 7) —
 * visually distinct from both the case file (ResultCard) and a failure
 * (ErrorNote): this is a successful, honest answer, just not a new dossier. */
export function AgentAnswer({ text }: AgentAnswerProps) {
  return (
    <div className="agent-answer">
      <p>{text}</p>
    </div>
  );
}
