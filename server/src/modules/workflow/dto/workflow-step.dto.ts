import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class WorkflowStepDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(/^\S+$/)
  command: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  args: string[];

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]{1,20}$/)
  outputExtension?: string;

  @IsOptional()
  @IsBoolean()
  inPlace?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  timeoutSeconds?: number;
}
