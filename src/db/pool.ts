import pg from 'pg';

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 5 });
}

export type Queryable = Pick<pg.Pool, 'query'>;
