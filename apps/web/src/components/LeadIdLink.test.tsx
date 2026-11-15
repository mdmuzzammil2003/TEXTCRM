import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LeadIdLink, OpenSolarIcon } from './LeadIdLink.tsx';

describe('LeadIdLink', () => {
  afterEach(cleanup);

  it('links a Lead ID to its OpenSolar project in a new tab', () => {
    render(<LeadIdLink value="7628533" />);
    const link = screen.getByRole('link', { name: 'Lead ID 7628533, open in OpenSolar (new tab)' });
    expect(link.getAttribute('href')).toBe('https://app.opensolar.com/projects/7628533/manage');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('7628533');
  });

  it('shows a plain dash, not a link, when there is no ID', () => {
    render(
      <>
        <LeadIdLink value={null} label="Project ID" />
        <OpenSolarIcon value="" />
      </>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });
});
