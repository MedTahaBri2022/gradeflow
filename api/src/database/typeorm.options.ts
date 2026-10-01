import type { DataSourceOptions } from 'typeorm';
import { ImportError, ImportJob } from '../imports/import.entity';
import { Init1759449600000 } from './migrations/1759449600000-init';

/** Shared by the HTTP app and the standalone worker. */
export function typeOrmOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: [ImportJob, ImportError],
    migrations: [Init1759449600000],
    synchronize: false,
    migrationsRun: true,
  };
}
