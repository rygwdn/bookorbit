import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsObject, IsOptional, IsPositive, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CreateIndexerDto } from './indexer.dto';

export class IndexerLoginDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  indexerId?: number;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateIndexerDto)
  configuration!: CreateIndexerDto;

  @IsString()
  @Matches(/\S/, { message: 'username must not be blank' })
  @MaxLength(320)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;
}
