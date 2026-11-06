import { requireSession } from '../../../src/auth/guard';
import type { Message, Translate } from '../../../src/i18n/index';
import { getI18n } from '../../../src/i18n/server';
import { getRuntime } from '../../../src/runtime';
import type { SongSummary } from '../../../src/sync/cycle';
import { LocalTime } from '../../components/client';
import { Badge, Card, PageTitle } from '../../components/ui';
import { labelFor, modeLabel, runStatus } from '../labels';

const COUNTS = [
  'appleSongs',
  'youtubeSongs',
  'linkedLocally',
  'added',
  'plannedAdds',
  'deleted',
  'plannedDeletes',
  'searched',
  'pending',
  'failures',
] as const;

function Songs({ t, title, songs }: { t: Translate; title: string; songs: SongSummary[] }) {
  if (songs.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer">
        {title} ({songs.length})
      </summary>
      <ul className="mt-2 space-y-1 text-muted">
        {songs.map((song, index) => (
          <li key={index} className="break-words">
            {song.title} — {song.artist} <span className="whitespace-nowrap">({t(`services.${song.to}`)})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function HistoryPage() {
  await requireSession();
  const { t, say } = await getI18n();
  const runs = await getRuntime().state.recentRuns(30);

  return (
    <>
      <PageTitle title={t('history.title')} description={t('history.description')} />
      <div className="space-y-4">
        {runs.length === 0 ? (
          <Card>
            <p className="text-muted">{t('history.empty')}</p>
          </Card>
        ) : null}
        {runs.map((run) => {
          const status = runStatus(t, run.status);
          const summary = run.summary as Record<string, unknown>;
          return (
            <Card key={run.id}>
              <p className="mb-2 flex flex-wrap items-center gap-2">
                <LocalTime value={run.startedAt} />
                <Badge tone={status.tone}>{status.label}</Badge>
                <span className="text-muted">{modeLabel(t, run.mode)}</span>
              </p>
              <dl className="flex flex-wrap gap-x-4 gap-y-1">
                {COUNTS.filter((key) => Number(summary[key] ?? 0) > 0).map((key) => (
                  <div key={key} className="flex gap-1">
                    <dt className="text-muted">{t(`history.counts.${key}`)}:</dt>
                    <dd>{String(summary[key])}</dd>
                  </div>
                ))}
              </dl>
              {summary.error ? <p className="mt-2 text-bad break-words">{say(summary.error as Message)}</p> : null}
              {typeof summary.blockedReason === 'string' ? (
                <p className="mt-2 text-warn">
                  {t('history.reason', { reason: labelFor(t, 'history.blockedReasons', summary.blockedReason) })}
                </p>
              ) : null}
              {Array.isArray(summary.missing) ? (
                <p className="mt-2 text-muted">
                  {t('history.missing', {
                    items: summary.missing.map((item) => labelFor(t, 'history.missingItems', String(item))).join(', '),
                  })}
                </p>
              ) : null}
              {summary.deleteDecision === 'over_limit' ? <p className="mt-2 text-warn">{t('history.overLimit')}</p> : null}
              <Songs
                t={t}
                title={run.mode === 'dry-run' ? t('history.wouldAdd') : t('history.added')}
                songs={(summary.addSample as SongSummary[]) ?? []}
              />
              <Songs
                t={t}
                title={summary.deleted ? t('history.removed') : t('history.wouldRemove')}
                songs={(summary.deleteSample as SongSummary[]) ?? []}
              />
            </Card>
          );
        })}
      </div>
    </>
  );
}
