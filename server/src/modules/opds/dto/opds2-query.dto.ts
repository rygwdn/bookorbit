import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class Opds2QueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) size = 20;
  @IsOptional() @IsString() @MaxLength(256) query?: string;
  @IsOptional() @IsString() @MaxLength(256) author?: string;
  @IsOptional() @IsString() @MaxLength(256) series?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) seriesId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) libraryId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) collectionId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) smartScopeId?: number;
  @IsOptional() @IsIn(['unread', 'reading', 'finished']) readStatus?: 'unread' | 'reading' | 'finished';
}
