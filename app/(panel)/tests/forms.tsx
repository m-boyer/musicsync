'use client';

import { useActionState } from 'react';
import { buttonClass, Card, Notice } from '../../components/ui';
import { startTest, type FormState } from '../actions';

export function TestForms({ disabled }: { disabled: boolean }) {
  const [readState, readAction, readPending] = useActionState<FormState, FormData>(startTest.bind(null, 'read'), {});
  const [writeState, writeAction, writePending] = useActionState<FormState, FormData>(startTest.bind(null, 'write'), {});

  return (
    <>
      <Card title="Read test">
        <p className="mb-3 text-muted">Read only. Shows which connection works on Apple Music and reads both chosen playlists.</p>
        <form action={readAction}>
          {readState.message ? <div className="mb-3"><Notice tone="bad">{readState.message}</Notice></div> : null}
          <button className={buttonClass} disabled={disabled || readPending}>Run read test</button>
        </form>
      </Card>
      <Card title="Add and remove test">
        <p className="mb-3 text-muted">
          Adds and removes one song on each chosen playlist, and can take a few minutes. It never touches a song already in them, so pick one that is in neither.
        </p>
        <form action={writeAction} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm">Song and artist</span>
            <input name="query" required maxLength={200} />
          </label>
          {writeState.message ? <Notice tone="bad">{writeState.message}</Notice> : null}
          <button className={buttonClass} disabled={disabled || writePending}>Run add and remove test</button>
        </form>
      </Card>
    </>
  );
}
