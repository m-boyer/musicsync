import { requireSession } from '../../../src/auth/guard';
import { getRuntime } from '../../../src/runtime';
import { LocalTime } from '../../components/client';
import { Badge, Card, Notice, PageTitle, secondaryButtonClass } from '../../components/ui';
import { removeCredential } from '../actions';
import { SERVICE_NAMES, tokenAgeDays, TOKEN_WARN_DAYS } from '../labels';
import { CredentialForm } from './form';

const HELP = {
  apple: {
    label: 'media-user-token',
    steps:
      'En music.apple.com con tu sesión iniciada, abrí DevTools → Application → Cookies → https://music.apple.com y copiá el valor de media-user-token. Dura unos 180 días.',
  },
  youtube: {
    label: 'Cookie',
    steps:
      'En una ventana privada, iniciá sesión en music.youtube.com. Abrí DevTools → Network, elegí un pedido a /youtubei/ y copiá el encabezado Cookie completo. Después cerrá esa ventana sin cerrar sesión.',
  },
};

export default async function CredentialsPage() {
  await requireSession();
  const status = await getRuntime().credentials.status();

  return (
    <>
      <PageTitle
        title="Credenciales"
        description="Se guardan cifradas y nunca se vuelven a mostrar. Para cambiarlas, cargalas de nuevo."
      />
      <div className="space-y-4">
        {(['apple', 'youtube'] as const).map((service) => {
          const current = status.find((item) => item.service === service);
          const age = current ? tokenAgeDays(current.updatedAt) : 0;
          return (
            <Card key={service} title={SERVICE_NAMES[service]}>
              <p className="mb-3 flex flex-wrap items-center gap-2">
                {current ? <Badge tone="ok">Cargada</Badge> : <Badge tone="bad">Sin cargar</Badge>}
                {current ? (
                  <span className="text-muted">
                    Actualizada: <LocalTime value={current.updatedAt} />
                  </span>
                ) : null}
              </p>
              {service === 'apple' && age >= TOKEN_WARN_DAYS ? (
                <div className="mb-3">
                  <Notice tone="warn">Este token tiene {age} días y vence cerca de los 180. Conviene renovarlo.</Notice>
                </div>
              ) : null}
              <p className="mb-3 text-muted">{HELP[service].steps}</p>
              <CredentialForm service={service} label={HELP[service].label} />
              {current ? (
                <form action={removeCredential.bind(null, service)} className="mt-3">
                  <button className={secondaryButtonClass}>Quitar</button>
                </form>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
