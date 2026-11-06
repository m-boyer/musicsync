import type { Queryable } from '../db/pool.js';
import type { Message } from '../i18n/index.js';

export type ProbeKind = 'read' | 'write';

export interface ProbeStep {
  name: Message;
  ok: boolean;
  detail?: Message;
  /** Present on a successful Apple read: the combination can be saved from the web. */
  connection?: { baseUrl: string; header: 'Music-User-Token' | 'media-user-token' };
}

export interface ProbeRun {
  id: string;
  kind: ProbeKind;
  status: 'running' | 'finished' | 'interrupted';
  steps: ProbeStep[];
  startedAt: Date;
  finishedAt: Date | null;
}

const KEEP_RUNS = 50;

export class ProbeRepo {
  constructor(private readonly db: Queryable) {}

  async start(kind: ProbeKind): Promise<string> {
    const { rows } = await this.db.query("INSERT INTO probe_runs (kind, status) VALUES ($1, 'running') RETURNING id", [
      kind,
    ]);
    return rows[0].id;
  }

  async addStep(id: string, step: ProbeStep): Promise<void> {
    await this.db.query('UPDATE probe_runs SET steps = steps || $1::jsonb WHERE id = $2', [
      JSON.stringify([step]),
      id,
    ]);
  }

  async finish(id: string): Promise<void> {
    await this.db.query("UPDATE probe_runs SET status = 'finished', finished_at = now() WHERE id = $1", [id]);
    await this.db.query('DELETE FROM probe_runs WHERE id NOT IN (SELECT id FROM probe_runs ORDER BY id DESC LIMIT $1)', [
      KEEP_RUNS,
    ]);
  }

  /** A restart stops any test in progress. */
  async markInterrupted(): Promise<void> {
    await this.db.query(
      "UPDATE probe_runs SET status = 'interrupted', finished_at = now() WHERE status = 'running'",
    );
  }

  async recent(limit: number): Promise<ProbeRun[]> {
    const { rows } = await this.db.query('SELECT * FROM probe_runs ORDER BY id DESC LIMIT $1', [limit]);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      steps: row.steps,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }));
  }
}
