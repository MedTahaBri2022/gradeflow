import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { interval, map, merge, Observable } from 'rxjs';
import { PaginationQueryDto } from '../common/pagination';
import { ImportEvents } from './import-events';
import { CreateImportDto, ImportListQueryDto } from './imports.dto';
import { ImportsService, MAX_FILE_BYTES } from './imports.service';
import type { UploadedCsv } from './imports.service';

const HEARTBEAT_MS = 25_000;

@ApiTags('imports')
@Controller('imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly events: ImportEvents,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Upload a CSV; it is processed in the background' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        notifyEmail: { type: 'string', format: 'email' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }),
  )
  create(
    @UploadedFile() file: UploadedCsv | undefined,
    @Body() dto: CreateImportDto,
  ) {
    return this.imports.create(file, dto);
  }

  @Get()
  list(@Query() query: ImportListQueryDto) {
    return this.imports.list(query);
  }

  // Declared before ':id' so "events" is never parsed as an import id.
  @Sse('events')
  @ApiOperation({ summary: 'Server-sent events: live progress of all imports' })
  stream(): Observable<MessageEvent> {
    return merge(
      this.events.stream.pipe(
        map((event) => ({ type: event.type, data: event })),
      ),
      // Keeps the connection open through proxies that close idle streams.
      interval(HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: {} }))),
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.findOne(id);
  }

  @Get(':id/errors')
  errors(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.imports.listErrors(id, query);
  }

  @Get(':id/errors.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async report(@Param('id', ParseUUIDPipe) id: string) {
    const { filename, csv } = await this.imports.errorReport(id);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      disposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    });
  }

  @Post(':id/retry')
  @HttpCode(202)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.retry(id);
  }
}
