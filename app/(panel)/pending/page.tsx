import Link from 'next/link';
import { requireSession } from '../../../src/auth/guard';
import type { Service, Track } from '../../../src/providers/types';
import { getRuntime } from '../../../src/runtime';
import { safeError } from '../../../src/sync/cycle';
import { Badge, Card, Notice, PageTitle, secondaryButtonClass } from '../../components/ui';
import { ignoreMatch, pickMatch, retryMatch } from '../actions';
import { SERVICE_NAMES } from '../labels';

const REASONS: Record<string, string> = {
  no_match: 'Sin coincidencia segura',
  duplicate_target: 'Otra canción ya usa esa coincidencia',
  never_appeared: 'Se agregó pero nunca apareció',
  manual: 'Ignorada a mano',
};

async function searchOtherService(service: Service, title: string, artist: string): Promise<{ results: Track[]; error?: string }> {
  const runtime = getRuntime();
  try {
    return await runtime.controller.exclusive(async () => {
      const loaded = await runtime.loader.load();
      if (loaded.status !== 'ready') return { results: [], error: 'Faltan credenciales.' };
      const target = service === 'apple' ? loaded.deps.youtube : loaded.deps.apple;
      return { results: await target.search({ id: '', title, artist }) };
    });
  } catch (error) {
    return { results: [], error: safeError(error).message };
  }
}

export default async function PendingPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  await requireSession();
  const { search } = await searchParams;
  const matches = (await getRuntime().state.getMatches()).filter((match) => match.status !== 'matched');
  const selected = matches.find((match) => `${match.service}:${match.sourceId}` === search);
  const found = selected ? await searchOtherService(selected.service, selected.title, selected.artist) : undefined;

  return (
    <>
      <PageTitle title="Pendientes" description="Canciones que no se sincronizan hasta que decidas qué hacer." />
      <div className="space-y-4">
        {matches.length === 0 ? <Card><p className="text-muted">No hay canciones pendientes.</p></Card> : null}
        {matches.map((match) => {
          const key = `${match.service}:${match.sourceId}`;
          return (
            <Card key={key}>
              <p className="font-medium break-words">{match.title}</p>
              <p className="text-muted break-words">{match.artist} · en {SERVICE_NAMES[match.service]}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={match.status === 'ignored' ? 'neutral' : 'warn'}>{REASONS[match.reason ?? ''] ?? match.reason ?? 'Pendiente'}</Badge>
                {match.targetTitle ? (
                  <span className="text-muted break-words">
                    Mejor resultado: {match.targetTitle} — {match.targetArtist}
                    {match.score === undefined ? '' : ` (${Math.round(match.score * 100)} %)`}
                  </span>
                ) : null}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link className={secondaryButtonClass} href={`/pending?search=${encodeURIComponent(key)}`}>Buscar coincidencia</Link>
                <form action={retryMatch.bind(null, match.service, match.sourceId)}><button className={secondaryButtonClass}>Reintentar</button></form>
                {match.status === 'ignored' ? null : (
                  <form action={ignoreMatch.bind(null, match.service, match.sourceId)}><button className={secondaryButtonClass}>Ignorar</button></form>
                )}
              </div>
              {selected === match && found ? (
                <div className="mt-4 border-t border-line pt-3">
                  {found.error ? <Notice tone="bad">{found.error}</Notice> : null}
                  {!found.error && found.results.length === 0 ? <p className="text-muted">Sin resultados.</p> : null}
                  <ul className="space-y-2">
                    {found.results.map((track) => (
                      <li key={track.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="break-words">{track.title} — {track.artist}</span>
                        <form action={pickMatch.bind(null, match.service, match.sourceId, { id: track.id, title: track.title, artist: track.artist })}>
                          <button className={secondaryButtonClass}>Elegir</button>
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
