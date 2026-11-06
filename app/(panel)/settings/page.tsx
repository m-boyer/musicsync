import { requireSession } from '../../../src/auth/guard';
import { canUseFullMode } from '../../../src/repos/settings';
import { getRuntime } from '../../../src/runtime';
import { Card, PageTitle } from '../../components/ui';
import { getI18n } from '../../../src/i18n/server';
import { PasswordForm, SettingsForm } from './forms';

export default async function SettingsPage() {
  await requireSession();
  const { t } = await getI18n();
  const settings = await getRuntime().settings.get();

  return (
    <>
      <PageTitle title={t('settings.title')} />
      <div className="space-y-4">
        <Card title={t('settings.sync')}>
          <SettingsForm
            fullAllowed={canUseFullMode(settings)}
            values={{
              mode: settings.mode,
              intervalSeconds: settings.intervalSeconds,
              maxOpsPerCycle: settings.maxOpsPerCycle,
              maxDeletesPerCycle: settings.maxDeletesPerCycle,
              addGraceMinutes: settings.addGraceMinutes,
              matchThreshold: settings.matchThreshold,
              appleStorefront: settings.appleStorefront,
            }}
          />
        </Card>
        <Card title={t('settings.appleConnection')}>
          <p className="text-muted break-words">
            {t('settings.appleConnectionText', {
              host: settings.appleBaseUrl ?? t('settings.defaultHost'),
              header: settings.appleUserTokenHeader,
            })}
          </p>
        </Card>
        <Card title={t('settings.changePassword')}>
          <PasswordForm />
        </Card>
      </div>
    </>
  );
}
