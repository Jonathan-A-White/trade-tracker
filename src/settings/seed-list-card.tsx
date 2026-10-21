import { useState } from "react";
import { useAlive } from "pwa-kit/alive";
import { seedItems } from "./seed-lists";
import type { SeedList } from "./seed-lists";
import { AddedSummary, OUTLINE_BUTTON_CLASS, SectionCard, SectionNote, SuccessNote } from "./parts";

/** One seed list's card: its blurb, a load button, and the counts once loaded. */
export function SeedListCard({
  list,
  description,
  buttonLabel,
}: {
  list: SeedList;
  description: string;
  buttonLabel: string;
}) {
  const alive = useAlive();
  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  async function handleLoad() {
    setSeeding(true);
    try {
      const added = await seedItems(list);
      if (alive()) setResult(added);
    } catch {
      // silently fail
    } finally {
      if (alive()) setSeeding(false);
    }
  }

  return (
    <SectionCard title={list.title}>
      <SectionNote>{description}</SectionNote>
      {result ? (
        <SuccessNote>
          <AddedSummary
            added={result.added}
            skipped={result.skipped}
            noun="item"
            skippedTail="already in library"
          />
        </SuccessNote>
      ) : (
        <button
          type="button"
          disabled={seeding}
          onClick={handleLoad}
          className={`w-full disabled:opacity-50 ${OUTLINE_BUTTON_CLASS}`}
        >
          {seeding ? "Loading..." : buttonLabel}
        </button>
      )}
    </SectionCard>
  );
}
