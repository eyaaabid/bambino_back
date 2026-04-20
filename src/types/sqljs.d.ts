declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | null
  export type BindParams = SqlValue[] | Record<string, SqlValue>

  export interface QueryExecResult {
    columns: string[]
    values: SqlValue[][]
  }

  export class Statement {
    bind(params?: BindParams): boolean
    step(): boolean
    getAsObject(): Record<string, SqlValue>
    free(): void
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null)
    exec(sql: string): QueryExecResult[]
    prepare(sql: string): Statement
    close(): void
  }

  export interface SqlJsStatic {
    Database: typeof Database
  }

  export interface InitSqlJsOptions {
    locateFile?: (file: string) => string
  }

  export default function initSqlJs(config?: InitSqlJsOptions): Promise<SqlJsStatic>
}
