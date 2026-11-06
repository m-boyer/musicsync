import { requireSession } from '../../../src/auth/guard';
import { getI18n } from '../../../src/i18n/server';
import { getRuntime } from '../../../src/runtime';
import { LocalTime } from '../../components/client';
import { Badge, Card, Notice, PageTitle, secondaryButtonClass } from '../../components/ui';
import { removeCredential } from '../actions';
import { tokenAgeDays, TOKEN_WARN_DAYS } from '../labels';
import { CredentialForm } from './form';

export default async function CredentialsPage() {
  await requireSession();
  const { t } = await getI18n();
  const status = await getRuntime().credentials.status();
  const help = {
    apple: { label: 'media-user-token', steps: t('credentials.appleHelp') },
    youtube: { label: t('credentials.cookie'), steps: t('credentials.youtubeHelp') },
  };

  return (
    <>
      <PageTitle title={t('credentials.title')} description={t('credentials.description')} />
      <div className="space-y-4">
        {(['apple', 'youtube'] as const).map((service) => {
          const current = status.find((item) => item.service === service);
          const age = current ? tokenAgeDays(current.updatedAt) : 0;
          return (
            <Card key={service} title={t(`services.${service}`)}>
              <p className="mb-3 flex flex-wrap items-center gap-2">
                {current ? <Badge tone="ok">{t('common.saved')}</Badge> : <Badge tone="bad">{t('common.notSaved')}</Badge>}
                {current ? (
                  <span className="text-muted">
                    {t('credentials.updated')} <LocalTime value={current.updatedAt} />
                  </span>
                ) : null}
              </p>
              {service === 'apple' && age >= TOKEN_WARN_DAYS ? (
                <div className="mb-3">
                  <Notice tone="warn">{t('credentials.tokenOld', { days: age })}</Notice>
                </div>
              ) : null}
              <p className="mb-3 text-muted">{help[service].steps}</p>
              <CredentialForm service={service} label={help[service].label} />
              {current ? (
                <form action={removeCredential.bind(null, service)} className="mt-3">
                  <button className={secondaryButtonClass}>{t('credentials.remove')}</button>
                </form>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
