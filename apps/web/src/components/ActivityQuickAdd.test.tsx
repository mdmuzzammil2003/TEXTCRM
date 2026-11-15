import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fullAccessProfile, renderPage } from '../test/render.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/index.ts';
import { ActivityQuickAdd, ActivityTimeline } from './ActivityTimeline.tsx';
import { useActivityTabs } from './activity-tabs.ts';

const LEAD = '11111111-1111-4111-8111-111111111111';

function Card() {
  const tabs = useActivityTabs('files');
  return (
    <Tabs value={tabs.tab} onValueChange={tabs.setTab}>
      <TabsList>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
      </TabsList>
      <ActivityQuickAdd entityType="lead" active={tabs.composing} onPick={tabs.compose} />
      <TabsContent value="activity">
        <ActivityTimeline
          entityType="lead"
          entityId={LEAD}
          composing={tabs.composing}
          onComposerClose={tabs.closeComposer}
        />
      </TabsContent>
      <TabsContent value="files">files panel</TabsContent>
    </Tabs>
  );
}

const render = () =>
  renderPage(<Card />, {
    path: '/leads',
    auth: fakeAuth({ status: 'signedIn', profile: fullAccessProfile() }),
    responses: { 'activities.list': [], 'users.list': [] },
  });

describe('Note / Call / Task / Meeting on the tab row', () => {
  afterEach(cleanup);

  it('opens the Activity tab with the chosen form, and closes it again', async () => {
    render();
    expect(await screen.findByText('files panel')).toBeTruthy();
    expect(screen.queryByText('New call')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    expect(await screen.findByText('New call')).toBeTruthy();
    expect(screen.getByText('Outcome')).toBeTruthy();
    expect(screen.queryByText('files panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Task' }));
    expect(await screen.findByText('New task')).toBeTruthy();
    expect(screen.queryByText('New call')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('New task')).toBeNull();
  });
});
