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
      'Signed in on music.apple.com, open DevTools → Application → Cookies → https://music.apple.com and copy the value of media-user-token. It lasts about 180 days.',
  },
  youtube: {
    label: 'Cookie',
    steps:
      'In a private window, sign in on music.youtube.com. Open DevTools → Network, pick a request to /youtubei/ and copy the whole Cookie header. Then close that window without signing out.',
  },
};

export default async function CredentialsPage() {
  await requireSession();
  const status = await getRuntime().credentials.status();

  return (
    <>
      <PageTitle
        title="Credentials"
        description="They are stored encrypted and never shown again. To change one, save it again."
      />
      <div className="space-y-4">
        {(['apple', 'youtube'] as const).map((service) => {
          const current = status.find((item) => item.service === service);
          const age = current ? tokenAgeDays(current.updatedAt) : 0;
          return (
            <Card key={service} title={SERVICE_NAMES[service]}>
              <p className="mb-3 flex flex-wrap items-center gap-2">
                {current ? <Badge tone="ok">Saved</Badge> : <Badge tone="bad">Not saved</Badge>}
                {current ? (
                  <span className="text-muted">
                    Updated: <LocalTime value={current.updatedAt} />
                  </span>
                ) : null}
              </p>
              {service === 'apple' && age >= TOKEN_WARN_DAYS ? (
                <div className="mb-3">
                  <Notice tone="warn">This token is {age} days old and expires around day 180. Renew it soon.</Notice>
                </div>
              ) : null}
              <p className="mb-3 text-muted">{HELP[service].steps}</p>
              <CredentialForm service={service} label={HELP[service].label} />
              {current ? (
                <form action={removeCredential.bind(null, service)} className="mt-3">
                  <button className={secondaryButtonClass}>Remove</button>
                </form>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
