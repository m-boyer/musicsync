import Link from 'next/link';
import { requireSession } from '../../src/auth/guard';
import type { Message } from '../../src/i18n/index';
import { getI18n } from '../../src/i18n/server';
import { getRuntime } from '../../src/runtime';
import { AutoRefresh, LocalTime } from '../components/client';
import { Badge, buttonClass, Card, Notice, PageTitle, type Tone } from '../components/ui';
import { runNow } from './actions';
import { modeLabel, runStatus, tokenAgeDays, TOKEN_WARN_DAYS } from './labels';

export default async function HomePage() {
  await requireSession();
  const { t, say } = await getI18n();
  const runtime = getRuntime();
  const [settings, credentials, runs, matches] = await Promise.all([
    runtime.settings.get(),
    runtime.credentials.status(),
    runtime.state.recentRuns(1),
    runtime.state.getMatches(),
  ]);
  const state = runtime.controller.state();
  const last = runs[0];
  const summary = (last?.summary ?? {}) as Record<string, unknown>;
  const pending = matches.filter((match) => match.status === 'pending').length;
  const lastStatus = last ? runStatus(t, last.status) : undefined;
  const ready = credentials.length >= 2 && settings.applePlaylist && settings.youtubePlaylist;

  return (
    <>
      <AutoRefresh active={state.running} />
      <PageTitle title={t('home.title')} description={t('home.description')} />
      <div className="space-y-4">
        {credentials.length < 2 ? (
          <Notice tone="warn">
            {t('home.missingCredentials')}{' '}
            <Link className="underline" href="/credentials">
              {t('home.addThemHere')}
            </Link>
            .
          </Notice>
        ) : !settings.applePlaylist || !settings.youtubePlaylist ? (
          <Notice tone="warn">
            {t('home.missingPlaylists')}{' '}
            <Link className="underline" href="/playlists">
              {t('home.chooseThemHere')}
            </Link>
            .
          </Notice>
        ) : null}

        <Card
          title={t('home.sync')}
          footer={
            <form action={runNow}>
              <button className={buttonClass} disabled={state.running || !ready}>
                {state.running ? t('home.syncing') : t('home.syncNow')}
              </button>
            </form>
          }
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted">{t('home.mode')}</dt>
            <dd>{modeLabel(t, settings.mode)}</dd>
            <dt className="text-muted">{t('home.lastCycle')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <LocalTime value={last?.startedAt} />
              {lastStatus ? <Badge tone={lastStatus.tone}>{lastStatus.label}</Badge> : null}
            </dd>
            <dt className="text-muted">{t('home.nextCycle')}</dt>
            <dd>{state.running ? t('home.running') : <LocalTime value={state.nextRunAt} />}</dd>
            {summary.error ? (
              <>
                <dt className="text-muted">{t('home.error')}</dt>
                <dd className="text-bad break-words">{say(summary.error as Message)}</dd>
              </>
            ) : null}
          </dl>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {(['apple', 'youtube'] as const).map((service) => {
            const credential = credentials.find((item) => item.service === service);
            const age = credential ? tokenAgeDays(credential.updatedAt) : 0;
            const tone: Tone = !credential ? 'bad' : service === 'apple' && age >= TOKEN_WARN_DAYS ? 'warn' : 'ok';
            const songs = service === 'apple' ? summary.appleSongs : summary.youtubeSongs;
            const playlist = service === 'apple' ? settings.applePlaylist : settings.youtubePlaylist;
            return (
              <Card key={service} title={t(`services.${service}`)}>
                <Badge tone={tone}>
                  {!credential
                    ? t('common.notSaved')
                    : tone === 'warn'
                      ? t('home.tokenAge', { days: age })
                      : t('common.saved')}
                </Badge>
                <p className="mt-2 break-words">
                  {playlist ? playlist.name : <span className="text-muted">{t('home.noPlaylist')}</span>}
                </p>
                <p className="text-muted">
                  {typeof songs === 'number' ? t('common.songs', { count: songs }) : t('home.noDataYet')}
                </p>
              </Card>
            );
          })}
        </div>

        <Card title={t('home.pending')}>
          <p>
            {pending === 0 ? t('home.noPending') : `${t('home.pendingCount', { count: pending })} `}
            {pending > 0 ? (
              <Link className="underline" href="/pending">
                {t('home.reviewThem')}
              </Link>
            ) : null}
          </p>
        </Card>
      </div>
    </>
  );
}
