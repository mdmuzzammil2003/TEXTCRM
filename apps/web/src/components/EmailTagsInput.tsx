import type { FieldControlProps } from '../ui/index.ts';
import { TagsInput } from './TagsInput.tsx';

const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Several email addresses in one box. Type an address and press Space (or Enter or comma) and it
 * becomes a tag; the first tag is the primary address, the rest are extra addresses. The value is
 * one space-separated string, which the server splits into primary + extras.
 */
export function EmailTagsInput(props: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  props: FieldControlProps;
}) {
  return (
    <TagsInput
      {...props}
      inputMode="email"
      placeholder="name@example.com — press Space to add another"
      tagTitle={(index) => (index === 0 ? 'Primary email' : 'Extra email')}
      tagClassName={(index) => (index === 0 ? 'font-medium' : undefined)}
      isValid={(tag) => LOOKS_LIKE_EMAIL.test(tag)}
    />
  );
}
