import Link from 'next/link';
import { requireSession } from '../../src/auth/guard';
import { getRuntime } from '../../src/runtime';
import { AutoRefresh, LocalTime } from '../components/client';
import { Badge, buttonClass, Card, Notice, PageTitle, type Tone } from '../components/ui';
import { runNow } from './actions';
import { MODE_LABELS, runStatus, SERVICE_NAMES, tokenAgeDays, TOKEN_WARN_DAYS } from './labels';

export default async function HomePage() {
  await requireSession();
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
  const lastStatus = last ? runStatus(last.status) : undefined;

  return (
    <>
      <AutoRefresh active={state.running} />
      <PageTitle title="Inicio" description="Sincroniza una playlist de Apple Music con una de YouTube Music." />
      <div className="space-y-4">
        {credentials.length < 2 ? (
          <Notice tone="warn">
            Faltan credenciales. <Link className="underline" href="/credentials">Cargalas acá</Link>.
          </Notice>
        ) : !settings.applePlaylist || !settings.youtubePlaylist ? (
          <Notice tone="warn">
            Falta elegir las playlists. <Link className="underline" href="/playlists">Elegilas acá</Link>.
          </Notice>
        ) : null}

        <Card
          title="Sincronización"
          footer={
            <form action={runNow}>
              <button
                className={buttonClass}
                disabled={state.running || credentials.length < 2 || !settings.applePlaylist || !settings.youtubePlaylist}
              >
                {state.running ? 'Sincronizando…' : 'Sincronizar ahora'}
              </button>
            </form>
          }
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted">Modo</dt>
            <dd>{MODE_LABELS[settings.mode]}</dd>
            <dt className="text-muted">Último ciclo</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <LocalTime value={last?.startedAt} />
              {lastStatus ? <Badge tone={lastStatus.tone}>{lastStatus.label}</Badge> : null}
            </dd>
            <dt className="text-muted">Próximo ciclo</dt>
            <dd>{state.running ? 'en curso' : <LocalTime value={state.nextRunAt} />}</dd>
            {typeof summary.error === 'string' ? (
              <>
                <dt className="text-muted">Error</dt>
                <dd className="text-bad break-words">{summary.error}</dd>
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
              <Card key={service} title={SERVICE_NAMES[service]}>
                <Badge tone={tone}>
                  {!credential ? 'Sin cargar' : tone === 'warn' ? `Token de ${age} días` : 'Cargada'}
                </Badge>
                <p className="mt-2 break-words">{playlist ? playlist.name : <span className="text-muted">Sin playlist elegida</span>}</p>
                <p className="text-muted">{typeof songs === 'number' ? `${songs} canciones` : 'Sin datos todavía'}</p>
              </Card>
            );
          })}
        </div>

        <Card title="Pendientes">
          <p>
            {pending === 0 ? 'No hay canciones pendientes.' : `${pending} canciones sin coincidencia. `}
            {pending > 0 ? <Link className="underline" href="/pending">Revisarlas</Link> : null}
          </p>
        </Card>
      </div>
    </>
  );
}
