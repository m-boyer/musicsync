'use client';

import { useActionState } from 'react';
import { useI18n } from '../../components/i18n';
import { buttonClass, Card, Notice } from '../../components/ui';
import { startTest, type FormState } from '../actions';

export function TestForms({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const [readState, readAction, readPending] = useActionState<FormState, FormData>(startTest.bind(null, 'read'), {});
  const [writeState, writeAction, writePending] = useActionState<FormState, FormData>(startTest.bind(null, 'write'), {});

  return (
    <>
      <Card title={t('tests.readTest')}>
        <p className="mb-3 text-muted">{t('tests.readHelp')}</p>
        <form action={readAction}>
          {readState.message ? <div className="mb-3"><Notice tone="bad">{readState.message}</Notice></div> : null}
          <button className={buttonClass} disabled={disabled || readPending}>{t('tests.runRead')}</button>
        </form>
      </Card>
      <Card title={t('tests.writeTest')}>
        <p className="mb-3 text-muted">
          {t('tests.writeHelp')}
        </p>
        <form action={writeAction} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm">{t('tests.songAndArtist')}</span>
            <input name="query" required maxLength={200} />
          </label>
          {writeState.message ? <Notice tone="bad">{writeState.message}</Notice> : null}
          <button className={buttonClass} disabled={disabled || writePending}>{t('tests.runWrite')}</button>
        </form>
      </Card>
    </>
  );
}
