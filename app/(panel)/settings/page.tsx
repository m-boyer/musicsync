import { requireSession } from '../../../src/auth/guard';
import { canUseFullMode } from '../../../src/repos/settings';
import { getRuntime } from '../../../src/runtime';
import { Card, PageTitle } from '../../components/ui';
import { PasswordForm, SettingsForm } from './forms';

export default async function SettingsPage() {
  await requireSession();
  const settings = await getRuntime().settings.get();

  return (
    <>
      <PageTitle title="Settings" />
      <div className="space-y-4">
        <Card title="Sync">
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
        <Card title="Apple Music connection">
          <p className="text-muted break-words">
            {settings.appleBaseUrl ?? 'Default host'} with {settings.appleUserTokenHeader}. Change it from Tests.
          </p>
        </Card>
        <Card title="Change password">
          <PasswordForm />
        </Card>
      </div>
    </>
  );
}
