import pg from "pg";

export interface DbConfig {
  connectionString: string;
  connectionTimeoutMillis?: number;
  max?: number;
}

export function createPool(config: DbConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 10_000,
    max: config.max ?? 10,
  });
}

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    queryText: string,
    values?: readonly unknown[]
  ): Promise<pg.QueryResult<R>>;
}

export type Db = Queryable;
export type DbPool = pg.Pool;
export type QueryResult<R extends pg.QueryResultRow = pg.QueryResultRow> = pg.QueryResult<R>;