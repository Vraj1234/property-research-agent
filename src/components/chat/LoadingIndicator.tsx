/** Lookups routinely take 15-90s (Parallel.ai `base` tier) or several
 * minutes with deep research enabled (`core` tier) — see decisions.md
 * 2026-08-26. This has to read as "working," not "stuck." */
export function LoadingIndicator({ deepResearch }: { deepResearch: boolean }) {
  return (
    <div className="loading-indicator" role="status">
      <span className="loading-indicator__seal" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <p>
        Researching
        {deepResearch ? " — deep research is on, this can take a few minutes" : "…"}
      </p>
    </div>
  );
}
