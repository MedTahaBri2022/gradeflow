import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Env, validateEnv } from './config/env';
import { typeOrmOptions } from './database/typeorm.options';
import { ImportEvents } from './imports/import-events';
import { ImportError, ImportJob } from './imports/import.entity';
import { ImportsController } from './imports/imports.controller';
import { ImportsService } from './imports/imports.service';
import { WorkerModule } from './processing/worker.module';
import { QueuesModule } from './queues/queues.module';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async check() {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
}

/** Infrastructure shared by the HTTP app and the standalone worker. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        typeOrmOptions(config.get('DATABASE_URL', { infer: true })),
    }),
  ],
})
export class CoreModule {}

@Module({
  imports: [
    CoreModule,
    QueuesModule,
    TypeOrmModule.forFeature([ImportJob, ImportError]),
    // One process is enough for development; in production the API can run
    // with RUN_WORKER=false next to dedicated `npm run start:worker` processes.
    ...(process.env.RUN_WORKER === 'false' ? [] : [WorkerModule]),
  ],
  controllers: [ImportsController, HealthController],
  providers: [ImportsService, ImportEvents],
})
export class AppModule {}
