import type { ReactNode } from 'react';

export function Card({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      {title ? <h2 className="mb-3 font-semibold">{title}</h2> : null}
      {children}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </section>
  );
}

export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description ? <p className="mt-1 text-muted">{description}</p> : null}
    </header>
  );
}

const TONES = {
  ok: 'text-ok border-ok/40',
  warn: 'text-warn border-warn/40',
  bad: 'text-bad border-bad/40',
  neutral: 'text-muted border-line',
};

export type Tone = keyof typeof TONES;

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-sm whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export const buttonClass =
  'inline-block cursor-pointer rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButtonClass =
  'inline-block cursor-pointer rounded-lg border border-line px-3 py-1.5 hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50';

export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <p className={`rounded-lg border p-3 ${TONES[tone]}`}>{children}</p>;
}
