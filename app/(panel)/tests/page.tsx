import { requireSession } from '../../../src/auth/guard';
import { getRuntime } from '../../../src/runtime';
import { AutoRefresh, LocalTime } from '../../components/client';
import { Badge, Card, PageTitle, secondaryButtonClass } from '../../components/ui';
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
      <PageTitle title="Pruebas" description="Confirman qué permite cada servicio desde este servidor." />
      <div className="space-y-4">
        <Card title="Estado del borrado">
          <ul className="space-y-1">
            <li>
              Apple Music:{' '}
              {settings.appleDeleteVerifiedAt ? <Badge tone="ok">Verificado</Badge> : <Badge tone="neutral">Sin verificar</Badge>}
            </li>
            <li>
              YouTube Music:{' '}
              {settings.youtubeDeleteVerifiedAt ? <Badge tone="ok">Verificado</Badge> : <Badge tone="neutral">Sin verificar</Badge>}
            </li>
          </ul>
        </Card>

        <TestForms disabled={running} />

        {runs.map((run) => (
          <Card key={run.id} title={run.kind === 'read' ? 'Prueba de lectura' : 'Prueba de agregar y borrar'}>
            <p className="mb-3 flex flex-wrap items-center gap-2 text-muted">
              <LocalTime value={run.startedAt} />
              {run.status === 'running' ? <Badge tone="neutral">En curso…</Badge> : null}
              {run.status === 'interrupted' ? <Badge tone="warn">Interrumpida</Badge> : null}
            </p>
            {run.steps.length === 0 ? <p className="text-muted">Sin resultados todavía.</p> : null}
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
                      <Badge tone={step.ok ? 'ok' : 'bad'}>{step.ok ? 'Bien' : 'Falló'}</Badge>
                      <span className="break-words">{step.name}</span>
                    </div>
                    {step.detail ? <p className="mt-1 text-muted break-words">{step.detail}</p> : null}
                    {connection ? (
                      isSaved ? (
                        <p className="mt-1 text-muted">Es la combinación en uso.</p>
                      ) : (
                        <form action={saveAppleConnection.bind(null, connection.baseUrl, connection.header)} className="mt-2">
                          <button className={secondaryButtonClass}>Usar esta combinación</button>
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
