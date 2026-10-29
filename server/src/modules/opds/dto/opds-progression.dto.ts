import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { OpdsProgression } from '@bookorbit/types';

class ProgressionDeviceDto {
  @IsString() @MinLength(1) @MaxLength(512) @Matches(/^[a-z][a-z0-9+.-]*:[^\s]+$/i) id!: string;
  @IsString() @MinLength(1) @MaxLength(256) name!: string;
}

export class OpdsProgressionDto implements OpdsProgression {
  @IsOptional() @IsString() @MaxLength(1024) title?: string;
  @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) modified!: string;
  @IsDefined() @ValidateNested() @Type(() => ProgressionDeviceDto) device!: ProgressionDeviceDto;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(1) progression!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(16) @IsString({ each: true }) @MaxLength(4096, { each: true }) references?: string[];
}
