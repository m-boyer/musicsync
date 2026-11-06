import { requireSession } from '../../../src/auth/guard';
import { getRuntime } from '../../../src/runtime';
import { AutoRefresh, LocalTime } from '../../components/client';
import { Badge, Card, Notice, PageTitle, secondaryButtonClass } from '../../components/ui';
import { saveAppleConnection } from '../actions';
import { TestForms } from './forms';

export default async function TestsPage() {
  await requireSession();
  const runtime = getRuntime();
  const [runs, settings] = await Promise.all([runtime.probes.recent(5), runtime.settings.get()]);
  const running = runs.some((run) => run.status === 'running');

  return (
    <>
      <AutoRefresh active={running} />
      <PageTitle title="Tests" description="Check what each service allows from this server." />
      <div className="space-y-4">
        {!settings.applePlaylist || !settings.youtubePlaylist ? (
          <Notice tone="warn">The tests use the chosen playlists: choose them first in Playlists.</Notice>
        ) : null}

        <Card title="Removing songs from the playlist">
          <ul className="space-y-1">
            <li>
              Apple Music:{' '}
              {settings.appleDeleteVerifiedAt ? <Badge tone="ok">Verified</Badge> : <Badge tone="neutral">Not verified</Badge>}
            </li>
            {settings.appleRemoveStrategy ? (
              <li className="text-muted">Method that works on Apple: {settings.appleRemoveStrategy}</li>
            ) : null}
            <li>
              YouTube Music:{' '}
              {settings.youtubeDeleteVerifiedAt ? <Badge tone="ok">Verified</Badge> : <Badge tone="neutral">Not verified</Badge>}
            </li>
          </ul>
        </Card>

        <TestForms disabled={running} />

        {runs.map((run) => (
          <Card key={run.id} title={run.kind === 'read' ? 'Read test' : 'Add and remove test'}>
            <p className="mb-3 flex flex-wrap items-center gap-2 text-muted">
              <LocalTime value={run.startedAt} />
              {run.status === 'running' ? <Badge tone="neutral">Running…</Badge> : null}
              {run.status === 'interrupted' ? <Badge tone="warn">Interrupted</Badge> : null}
            </p>
            {run.steps.length === 0 ? <p className="text-muted">No results yet.</p> : null}
            <ul className="space-y-3">
              {run.steps.map((step, index) => {
                const connection = step.connection;
                const isSaved =
                  connection &&
                  settings.appleBaseUrl === connection.baseUrl &&
                  settings.appleUserTokenHeader === connection.header;
                return (
                  <li key={index}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={step.ok ? 'ok' : 'bad'}>{step.ok ? 'Passed' : 'Failed'}</Badge>
                      <span className="break-words">{step.name}</span>
                    </div>
                    {step.detail ? <p className="mt-1 text-muted break-words">{step.detail}</p> : null}
                    {connection ? (
                      isSaved ? (
                        <p className="mt-1 text-muted">This is the combination in use.</p>
                      ) : (
                        <form action={saveAppleConnection.bind(null, connection.baseUrl, connection.header)} className="mt-2">
                          <button className={secondaryButtonClass}>Use this combination</button>
                        </form>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
