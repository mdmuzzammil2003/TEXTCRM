import { openSolarProjectUrl } from '@mms/shared';
import { ExternalLink } from 'lucide-react';
import { cn } from '../ui/index.ts';

/**
 * A Lead ID / Project ID (the same value) linking to its OpenSolar project in a new tab. An empty
 * ID is a plain dash, never a link.
 */
export function LeadIdLink({
  value,
  label = 'Lead ID',
  className,
}: {
  value: string | null | undefined;
  /** What the ID is called here: "Lead ID" on a lead, "Project ID" on a project. */
  label?: string;
  className?: string;
}) {
  if (!value) return <span className={cn('text-fg-subtle', className)}>—</span>;
  return (
    <a
      href={openSolarProjectUrl(value)}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in OpenSolar"
      aria-label={`${label} ${value}, open in OpenSolar (new tab)`}
      className={cn(
        'inline-flex items-center gap-1 font-mono hover:text-accent-text hover:underline',
        className,
      )}
    >
      {value}
      <ExternalLink aria-hidden className="size-3.5 shrink-0" />
    </a>
  );
}

/**
 * Just the 🔗 to OpenSolar, for places where the ID itself already links somewhere (a project row
 * opens the project). Nothing when there is no ID.
 */
export function OpenSolarIcon({
  value,
  label = 'Project ID',
}: {
  value: string | null | undefined;
  label?: string;
}) {
  if (!value) return null;
  return (
    <a
      href={openSolarProjectUrl(value)}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in OpenSolar"
      aria-label={`${label} ${value}, open in OpenSolar (new tab)`}
      onClick={(event) => {
        event.stopPropagation();
      }}
      className="inline-flex shrink-0 items-center text-fg-subtle hover:text-accent-text"
    >
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );
}
