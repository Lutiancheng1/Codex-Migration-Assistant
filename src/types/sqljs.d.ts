declare module "sql.js" {
  export type BindValue = string | number | Uint8Array | null;

  export interface Statement {
    bind(values?: BindValue[] | Record<string, BindValue>): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  export interface Database {
    prepare(sql: string): Statement;
    run(sql: string, params?: BindValue[] | Record<string, BindValue>): void;
    exec(sql: string, params?: BindValue[] | Record<string, BindValue>): Array<{ columns: string[]; values: unknown[][] }>;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
