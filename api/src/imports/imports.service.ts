import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { Not, Repository } from 'typeorm';
import { Paginated, paginate, PaginationQueryDto } from '../common/pagination';
import { missingColumns } from '../processing/row-parser';
import {
  IMPORT_JOB_OPTIONS,
  ImportJobData,
  importJobId,
  IMPORTS_QUEUE,
} from '../queues/queues';
import { ImportError, ImportJob, ImportStatus } from './import.entity';
import type { CreateImportDto, ImportListQueryDto } from './imports.dto';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ENQUEUE_TIMEOUT_MS = 5000;

export interface UploadedCsv {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class ImportsService {
  constructor(
    @InjectRepository(ImportJob)
    private readonly imports: Repository<ImportJob>,
    @InjectRepository(ImportError)
    private readonly errors: Repository<ImportError>,
    @InjectQueue(IMPORTS_QUEUE)
    private readonly queue: Queue<ImportJobData>,
  ) {}

  /**
   * Accepts a file and returns immediately; the rows are processed by a
   * worker. Only cheap checks run in the request: structure and duplicates.
   */
  async create(
    file: UploadedCsv | undefined,
    dto: CreateImportDto,
  ): Promise<ImportJob> {
    if (!file) throw new BadRequestException('A CSV file is required');
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are accepted');
    }

    const text = file.buffer.toString('utf8');
    // Drop the byte-order mark that spreadsheet exports put first.
    const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length < 2) {
      throw new BadRequestException(
        'The file must contain a header and at least one row',
      );
    }
    const missing = missingColumns(lines[0].split(','));
    if (missing.length) {
      throw new BadRequestException(`Missing column(s): ${missing.join(', ')}`);
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.imports.findOne({
      where: { checksum, status: Not(ImportStatus.Failed) },
    });
    if (duplicate) {
      throw new ConflictException(
        `This file was already imported (import ${duplicate.id})`,
      );
    }

    // A concurrent upload of the same file passes the check above but is
    // stopped by the unique index (409 through the exception filter).
    const record = await this.imports.save(
      this.imports.create({
        filename: file.originalname,
        checksum,
        totalRows: lines.length - 1,
        notifyEmail: dto.notifyEmail ?? null,
        content,
      }),
    );

    try {
      await this.enqueue(record);
    } catch {
      // Do not leave an import that nothing will ever process.
      await this.imports.delete(record.id);
      throw new ServiceUnavailableException(
        'The job queue is unavailable, please retry in a moment',
      );
    }
    return this.findOne(record.id);
  }

  async list(query: ImportListQueryDto): Promise<Paginated<ImportJob>> {
    const [rows, total] = await this.imports.findAndCount({
      where: query.status ? { status: query.status } : {},
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginate(rows, total, query);
  }

  async findOne(id: string): Promise<ImportJob> {
    const record = await this.imports.findOne({ where: { id } });
    if (!record) throw new NotFoundException('Import not found');
    return record;
  }

  async listErrors(
    id: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<ImportError>> {
    await this.findOne(id);
    const [rows, total] = await this.errors.findAndCount({
      where: { importId: id },
      order: { rowNumber: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginate(rows, total, query);
  }

  /** The rejected rows as CSV, with the reason, ready to be fixed and re-uploaded. */
  async errorReport(id: string): Promise<{ filename: string; csv: string }> {
    const record = await this.findOne(id);
    const rows = await this.errors.find({
      where: { importId: id },
      order: { rowNumber: 'ASC' },
    });

    const columns = [
      'row',
      'student_email',
      'student_name',
      'course_code',
      'score',
      'graded_on',
      'error',
    ];
    const lines = rows.map((row) =>
      [
        String(row.rowNumber),
        row.raw.student_email,
        row.raw.student_name,
        row.raw.course_code,
        row.raw.score,
        row.raw.graded_on,
        row.message,
      ]
        .map(csvCell)
        .join(','),
    );
    return {
      filename: `${record.filename.replace(/\.csv$/i, '')}-errors.csv`,
      csv: [columns.join(','), ...lines].join('\n'),
    };
  }

  /** Manual retry of an import that exhausted its automatic attempts. */
  async retry(id: string): Promise<ImportJob> {
    const record = await this.findOne(id);
    if (record.status !== ImportStatus.Failed) {
      throw new ConflictException('Only failed imports can be retried');
    }

    // Conditional update: two simultaneous clicks enqueue a single job.
    const claimed = await this.imports
      .createQueryBuilder()
      .update()
      .set({
        status: ImportStatus.Queued,
        runs: () => 'runs + 1',
        error: null,
        finishedAt: null,
      })
      .where('id = :id AND status = :failed AND content IS NOT NULL', {
        id,
        failed: ImportStatus.Failed,
      })
      .returning('runs')
      .execute();
    if (!claimed.affected) {
      throw new ConflictException(
        'This import cannot be retried (already retried, or its file was purged)',
      );
    }

    await this.imports.query('DELETE FROM notifications WHERE import_id = $1', [
      id,
    ]);
    const retried = await this.findOne(id);
    await this.enqueue(retried);
    return retried;
  }

  private async enqueue(record: ImportJob): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('enqueue timed out')),
        ENQUEUE_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([
        this.queue.add(
          'import',
          { importId: record.id },
          { ...IMPORT_JOB_OPTIONS, jobId: importJobId(record.id, record.runs) },
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Quotes a CSV cell and neutralizes spreadsheet formula injection. */
export function csvCell(value: string | undefined): string {
  let cell = value ?? '';
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
