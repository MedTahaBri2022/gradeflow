import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from './app.module';
import { WorkerModule } from './processing/worker.module';

@Module({ imports: [CoreModule, WorkerModule] })
class StandaloneWorkerModule {}

/** Job consumers without the HTTP server: `npm run start:worker`. */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(
    StandaloneWorkerModule,
  );
  // On SIGTERM, BullMQ workers finish their current job before closing.
  app.enableShutdownHooks();
  new Logger('Worker').log('Worker started, waiting for jobs');
}
void bootstrap();
