import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Queue } from 'bullmq';
import { Env, redisConnection } from '../config/env';
import {
  IMPORTS_QUEUE,
  MAINTENANCE_QUEUE,
  NOTIFICATIONS_QUEUE,
} from './queues';

@ApiTags('queues')
@Controller('queues')
class QueuesController {
  private readonly queues: Queue[];

  constructor(
    @InjectQueue(IMPORTS_QUEUE) imports: Queue,
    @InjectQueue(NOTIFICATIONS_QUEUE) notifications: Queue,
    @InjectQueue(MAINTENANCE_QUEUE) maintenance: Queue,
  ) {
    this.queues = [imports, notifications, maintenance];
  }

  @Get()
  @ApiOperation({ summary: 'Job counts per queue and state' })
  counts() {
    return Promise.all(
      this.queues.map(async (queue) => ({
        name: queue.name,
        ...(await queue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'completed',
          'failed',
        )),
      })),
    );
  }
}

const queues = BullModule.registerQueue(
  { name: IMPORTS_QUEUE },
  { name: NOTIFICATIONS_QUEUE },
  { name: MAINTENANCE_QUEUE },
);

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisConnection(config.get('REDIS_URL', { infer: true })),
        prefix:
          config.get('NODE_ENV', { infer: true }) === 'test' ? 'gf-test' : 'gf',
      }),
    }),
    queues,
  ],
  controllers: [QueuesController],
  exports: [queues],
})
export class QueuesModule {}
