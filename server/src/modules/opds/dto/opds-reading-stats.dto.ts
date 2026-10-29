import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsDefined,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  OPDS_READING_STATS_BATCH_MAX,
  type OpdsReadingStatsBatch,
  type OpdsReadingStatsDevice,
  type OpdsReadingStatsSession,
} from '@bookorbit/types';

class StatsDeviceDto implements OpdsReadingStatsDevice {
  @IsString() @MinLength(1) @MaxLength(512) @Matches(/^[a-z][a-z0-9+.-]*:[^\s]+$/i) id!: string;
  @IsString() @MinLength(1) @MaxLength(256) name!: string;
}
class StatsSessionDto implements OpdsReadingStatsSession {
  @IsUUID('4') id!: string;
  @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) started!: string;
  @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) ended!: string;
  @IsInt() @Min(1) @Max(604800) activeSeconds!: number;
  @IsInt() @Min(0) @Max(1000000) pagesTurned!: number;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(1) startProgression?: number;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(1) endProgression?: number;
}
export class OpdsReadingStatsDto implements OpdsReadingStatsBatch {
  @Equals(1) version!: 1;
  @IsDefined() @ValidateNested() @Type(() => StatsDeviceDto) device!: StatsDeviceDto;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(OPDS_READING_STATS_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => StatsSessionDto)
  sessions!: StatsSessionDto[];
}
export class OpdsReadingStatsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) fileId?: number;
}
