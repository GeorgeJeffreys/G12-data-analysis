/**
 * The raw-export upload trigger button.
 *
 * While `busy` it is disabled (so the upload can't be double-submitted) and marks
 * itself `aria-busy`, but it does NOT render its own spinner/label — the single
 * loading indicator lives in the adjacent UploadStatusLine, which names the active
 * stage ("Ingesting — detecting and splitting subjects…") with one spinner. Keeping
 * a spinner here too duplicated that indicator, so the button stays a plain trigger.
 * Kept in its own module (not the page file, which may only export a page) so both
 * states render deterministically in tests. Matches the existing button styling.
 */
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

export function UploadButton({
  busy,
  label,
  variant,
  onClick,
}: {
  busy: boolean;
  label: string;
  variant: "pri" | "ghost";
  onClick?: () => void;
}) {
  const tint = variant === "pri" ? "#fff" : undefined;
  return (
    <Button variant={variant} onClick={onClick} disabled={busy} aria-busy={busy}>
      <Icon name="upload" size={13} color={tint} />
      {label}
    </Button>
  );
}
