import { requireSession } from '../../../src/auth/guard';
import { getRuntime } from '../../../src/runtime';
import type { SongSummary } from '../../../src/sync/cycle';
import { LocalTime } from '../../components/client';
import { Badge, Card, PageTitle } from '../../components/ui';
import { MODE_LABELS, runStatus, SERVICE_NAMES } from '../labels';

const COUNTS: [string, string][] = [
  ['appleSongs', 'En Apple'],
  ['youtubeSongs', 'En YouTube'],
  ['linkedLocally', 'Vinculadas'],
  ['added', 'Agregadas'],
  ['plannedAdds', 'Por agregar'],
  ['deleted', 'Borradas'],
  ['plannedDeletes', 'Por borrar'],
  ['searched', 'Búsquedas'],
  ['pending', 'Pendientes'],
  ['failures', 'Errores'],
];

function Songs({ title, songs }: { title: string; songs: SongSummary[] }) {
  if (songs.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer">{title} ({songs.length})</summary>
      <ul className="mt-2 space-y-1 text-muted">
        {songs.map((song, index) => (
          <li key={index} className="break-words">
            {song.title} — {song.artist} <span className="whitespace-nowrap">({SERVICE_NAMES[song.to]})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function HistoryPage() {
  await requireSession();
  const runs = await getRuntime().state.recentRuns(30);

  return (
    <>
      <PageTitle title="Historial" description="Últimos ciclos, con lo que se hizo o se haría." />
      <div className="space-y-4">
        {runs.length === 0 ? <Card><p className="text-muted">Todavía no hay ciclos.</p></Card> : null}
        {runs.map((run) => {
          const status = runStatus(run.status);
          const summary = run.summary as Record<string, unknown>;
          return (
            <Card key={run.id}>
              <p className="mb-2 flex flex-wrap items-center gap-2">
                <LocalTime value={run.startedAt} />
                <Badge tone={status.tone}>{status.label}</Badge>
                <span className="text-muted">{MODE_LABELS[run.mode as keyof typeof MODE_LABELS] ?? run.mode}</span>
              </p>
              <dl className="flex flex-wrap gap-x-4 gap-y-1">
                {COUNTS.filter(([key]) => Number(summary[key] ?? 0) > 0).map(([key, label]) => (
                  <div key={key} className="flex gap-1">
                    <dt className="text-muted">{label}:</dt>
                    <dd>{String(summary[key])}</dd>
                  </div>
                ))}
              </dl>
              {typeof summary.error === 'string' ? <p className="mt-2 text-bad break-words">{summary.error}</p> : null}
              {typeof summary.blockedReason === 'string' ? <p className="mt-2 text-warn">Motivo: {summary.blockedReason}</p> : null}
              {Array.isArray(summary.missing) ? <p className="mt-2 text-muted">Faltan credenciales: {summary.missing.join(', ')}</p> : null}
              {summary.deleteDecision === 'over_limit' ? <p className="mt-2 text-warn">No se borró nada: se superó el límite por ciclo.</p> : null}
              <Songs title={run.mode === 'dry-run' ? 'Se agregarían' : 'Agregadas'} songs={(summary.addSample as SongSummary[]) ?? []} />
              <Songs title={summary.deleted ? 'Borradas' : 'Se borrarían'} songs={(summary.deleteSample as SongSummary[]) ?? []} />
            </Card>
          );
        })}
      </div>
    </>
  );
}
