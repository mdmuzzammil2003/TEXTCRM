import { X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { cn, type FieldControlProps } from '../ui/index.ts';

const SEPARATORS = /[\s,;]+/;

/** "SO-1  SO-2" → ["SO-1", "SO-2"]. */
function splitTags(text: string): string[] {
  return text.split(SEPARATORS).filter(Boolean);
}

/**
 * Several values in one box. Type one and press Space (or Enter or comma) and it becomes a tag.
 * The value is one space-separated string; a value still being typed is part of it too, so
 * submitting the form never loses it.
 */
export function TagsInput({
  value,
  onChange,
  onBlur,
  name,
  props,
  placeholder,
  inputMode = 'text',
  tagTitle,
  isValid = () => true,
  tagClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  props: FieldControlProps;
  /** Shown while there are no tags. */
  placeholder?: string;
  inputMode?: 'text' | 'email';
  /** Tooltip of a tag, e.g. "Primary email" for the first one. */
  tagTitle?: (index: number) => string | undefined;
  /** Tags that fail are shown in red (the form's validation still decides). */
  isValid?: (tag: string) => boolean;
  /** Extra classes for a tag, e.g. bold for the primary email. */
  tagClassName?: (index: number) => string | undefined;
}) {
  const all = splitTags(value);
  const [typed, setTyped] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // The address being typed is the value's last word; drop it if the form changed the value.
  const draft = typed !== '' && all.at(-1) === typed ? typed : '';
  const tags = draft ? all.slice(0, -1) : all;
  const emit = (committed: string[], pending: string) => {
    onChange([...committed, pending].filter(Boolean).join(' '));
  };

  return (
    <div
      onClick={() => input.current?.focus()}
      className={cn(
        'flex min-h-8 w-full min-w-0 cursor-text flex-wrap items-center gap-1 rounded-md border border-line-strong bg-surface px-1.5 py-1 text-sm text-fg shadow-xs',
        'transition-[border-color,box-shadow] duration-100 hover:border-fg-subtle/60 focus-within:border-accent focus-within:ring-3 focus-within:ring-ring',
        props.invalid && 'border-danger focus-within:ring-danger/25',
      )}
    >
      {tags.map((tag, index) => (
        <span
          key={`${tag}-${String(index)}`}
          title={tagTitle?.(index)}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded bg-surface-2 py-0.5 pr-0.5 pl-2 text-fg',
            tagClassName?.(index),
            !isValid(tag) && 'bg-danger/10 text-danger',
          )}
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="rounded p-0.5 text-fg-muted hover:text-fg"
            onClick={(event) => {
              event.stopPropagation();
              onChange(tags.filter((_, i) => i !== index).join(' '));
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={input}
        {...props}
        name={name}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        aria-invalid={props.invalid || undefined}
        value={draft}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="min-w-40 flex-1 bg-transparent px-1 outline-none placeholder:text-fg-subtle"
        onChange={(event) => {
          const text = event.target.value;
          // A space, comma or semicolon (or a pasted list) finishes the address before it.
          const parts = text.split(SEPARATORS);
          const rest = parts.pop() ?? '';
          setTyped(rest);
          emit([...tags, ...parts.filter(Boolean)], rest);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter' && draft) {
            event.preventDefault();
            setTyped('');
          } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
            onChange(tags.slice(0, -1).join(' '));
          }
        }}
        onBlur={() => {
          setTyped('');
          onBlur?.();
        }}
      />
    </div>
  );
}
