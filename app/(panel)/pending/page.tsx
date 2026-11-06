import Link from 'next/link';
import { requireSession } from '../../../src/auth/guard';
import { render, type Locale } from '../../../src/i18n/index';
import { getI18n } from '../../../src/i18n/server';
import type { Service, Track } from '../../../src/providers/types';
import { getRuntime } from '../../../src/runtime';
import { errorMessage } from '../../../src/sync/cycle';
import { Badge, Card, Notice, PageTitle, secondaryButtonClass } from '../../components/ui';
import { ignoreMatch, pickMatch, retryMatch } from '../actions';
import { labelFor } from '../labels';

async function searchOtherService(
  locale: Locale,
  service: Service,
  title: string,
  artist: string,
): Promise<{ results: Track[]; error?: string }> {
  const runtime = getRuntime();
  try {
    return await runtime.controller.exclusive(async () => {
      const loaded = await runtime.loader.load();
      if (loaded.status !== 'ready') return { results: [], error: render(locale, { key: 'errors.credentialsMissing' }) };
      const target = service === 'apple' ? loaded.deps.youtube : loaded.deps.apple;
      return { results: await target.search({ id: '', title, artist }) };
    });
  } catch (error) {
    return { results: [], error: render(locale, errorMessage(error)) };
  }
}

export default async function PendingPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  await requireSession();
  const { locale, t } = await getI18n();
  const { search } = await searchParams;
  const matches = (await getRuntime().state.getMatches()).filter((match) => match.status !== 'matched');
  const selected = matches.find((match) => `${match.service}:${match.sourceId}` === search);
  const found = selected
    ? await searchOtherService(locale, selected.service, selected.title, selected.artist)
    : undefined;

  return (
    <>
      <PageTitle title={t('pending.title')} description={t('pending.description')} />
      <div className="space-y-4">
        {matches.length === 0 ? (
          <Card>
            <p className="text-muted">{t('pending.empty')}</p>
          </Card>
        ) : null}
        {matches.map((match) => {
          const key = `${match.service}:${match.sourceId}`;
          return (
            <Card key={key}>
              <p className="font-medium break-words">{match.title}</p>
              <p className="text-muted break-words">
                {match.artist} · {t('pending.on', { service: t(`services.${match.service}`) })}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={match.status === 'ignored' ? 'neutral' : 'warn'}>
                  {match.reason ? labelFor(t, 'pending.reasons', match.reason) : t('pending.pending')}
                </Badge>
                {match.targetTitle ? (
                  <span className="text-muted break-words">
                    {t('pending.bestResult', { title: match.targetTitle, artist: match.targetArtist ?? '' })}
                    {match.score === undefined ? '' : ` (${Math.round(match.score * 100)} %)`}
                  </span>
                ) : null}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link className={secondaryButtonClass} href={`/pending?search=${encodeURIComponent(key)}`}>
                  {t('pending.find')}
                </Link>
                <form action={retryMatch.bind(null, match.service, match.sourceId)}>
                  <button className={secondaryButtonClass}>{t('pending.retry')}</button>
                </form>
                {match.status === 'ignored' ? null : (
                  <form action={ignoreMatch.bind(null, match.service, match.sourceId)}>
                    <button className={secondaryButtonClass}>{t('pending.ignore')}</button>
                  </form>
                )}
              </div>
              {selected === match && found ? (
                <div className="mt-4 border-t border-line pt-3">
                  {found.error ? <Notice tone="bad">{found.error}</Notice> : null}
                  {!found.error && found.results.length === 0 ? <p className="text-muted">{t('common.noResults')}</p> : null}
                  <ul className="space-y-2">
                    {found.results.map((track) => (
                      <li key={track.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="break-words">
                          {track.title} — {track.artist}
                        </span>
                        <form
                          action={pickMatch.bind(null, match.service, match.sourceId, {
                            id: track.id,
                            title: track.title,
                            artist: track.artist,
                          })}
                        >
                          <button className={secondaryButtonClass}>{t('pending.choose')}</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
