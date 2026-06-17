/**
 * The raw-export upload trigger button with its in-flight loading state.
 *
 * While `busy` it is disabled (so the upload can't be double-submitted), swaps the
 * upload icon for a spinner, and reads "Uploading…"; otherwise it shows the upload
 * icon and the given label. Kept in its own module (not the page file, which may
 * only export a page) so both states render deterministically in tests — the busy
 * state is otherwise transient local state. Matches the existing button styling;
 * no new pattern.
 */
import { Button, Spinner } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

export function UploadButton({
  busy,
  label,
  variant,
  onClick,
  busyLabel = "Uploading…",
}: {
  busy: boolean;
  label: string;
  variant: "pri" | "ghost";
  onClick?: () => void;
  /** Label shown while busy — lets the caller name the active stage. */
  busyLabel?: string;
}) {
  const tint = variant === "pri" ? "#fff" : undefined;
  return (
    <Button variant={variant} onClick={onClick} disabled={busy} aria-busy={busy}>
      {busy ? <Spinner size={13} color={tint} /> : <Icon name="upload" size={13} color={tint} />}
      {busy ? busyLabel : label}
    </Button>
  );
}
