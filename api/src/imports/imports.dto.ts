import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination';
import { ImportStatus } from './import.entity';

export class CreateImportDto {
  @ApiPropertyOptional({
    description: 'Receives a summary when the import finishes',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsEmail()
  notifyEmail?: string;
}

export class ImportListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ImportStatus })
  @IsOptional()
  @IsEnum(ImportStatus)
  status?: ImportStatus;
}
