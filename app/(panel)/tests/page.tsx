import { requireSession } from '../../../src/auth/guard';
import { getRuntime } from '../../../src/runtime';
import { AutoRefresh, LocalTime } from '../../components/client';
import { Badge, Card, Notice, PageTitle, secondaryButtonClass } from '../../components/ui';
import { getI18n } from '../../../src/i18n/server';
import { saveAppleConnection } from '../actions';
import { TestForms } from './forms';

export default async function TestsPage() {
  await requireSession();
  const { t, say } = await getI18n();
  const runtime = getRuntime();
  const [runs, settings] = await Promise.all([runtime.probes.recent(5), runtime.settings.get()]);
  const running = runs.some((run) => run.status === 'running');

  return (
    <>
      <AutoRefresh active={running} />
      <PageTitle title={t('tests.title')} description={t('tests.description')} />
      <div className="space-y-4">
        {!settings.applePlaylist || !settings.youtubePlaylist ? (
          <Notice tone="warn">{t('tests.choosePlaylistsFirst')}</Notice>
        ) : null}

        <Card title={t('tests.removing')}>
          <ul className="space-y-1">
            <li>
              Apple Music:{' '}
              {settings.appleDeleteVerifiedAt ? <Badge tone="ok">{t('tests.verified')}</Badge> : <Badge tone="neutral">{t('tests.notVerified')}</Badge>}
            </li>
            {settings.appleRemoveStrategy ? (
              <li className="text-muted">{t('tests.appleMethod', { method: settings.appleRemoveStrategy })}</li>
            ) : null}
            <li>
              YouTube Music:{' '}
              {settings.youtubeDeleteVerifiedAt ? <Badge tone="ok">{t('tests.verified')}</Badge> : <Badge tone="neutral">{t('tests.notVerified')}</Badge>}
            </li>
          </ul>
        </Card>

        <TestForms disabled={running} />

        {runs.map((run) => (
          <Card key={run.id} title={run.kind === 'read' ? t('tests.readTest') : t('tests.writeTest')}>
            <p className="mb-3 flex flex-wrap items-center gap-2 text-muted">
              <LocalTime value={run.startedAt} />
              {run.status === 'running' ? <Badge tone="neutral">{t('tests.running')}</Badge> : null}
              {run.status === 'interrupted' ? <Badge tone="warn">{t('tests.interrupted')}</Badge> : null}
            </p>
            {run.steps.length === 0 ? <p className="text-muted">{t('tests.noResultsYet')}</p> : null}
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
                      <Badge tone={step.ok ? 'ok' : 'bad'}>{step.ok ? t('tests.passed') : t('tests.failed')}</Badge>
                      <span className="break-words">{say(step.name)}</span>
                    </div>
                    {step.detail ? <p className="mt-1 text-muted break-words">{say(step.detail)}</p> : null}
                    {connection ? (
                      isSaved ? (
                        <p className="mt-1 text-muted">{t('tests.inUse')}</p>
                      ) : (
                        <form action={saveAppleConnection.bind(null, connection.baseUrl, connection.header)} className="mt-2">
                          <button className={secondaryButtonClass}>{t('tests.useCombination')}</button>
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
