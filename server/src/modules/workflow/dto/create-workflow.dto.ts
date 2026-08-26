import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
  ValidateBy,
} from 'class-validator';

import { validatePattern } from '@bookorbit/types';
import { WorkflowStepDto } from './workflow-step.dto';

const IsWorkflowOutputFilenamePattern = () =>
  ValidateBy({
    name: 'isWorkflowOutputFilenamePattern',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && validatePattern(value),
      defaultMessage: () => 'Pattern contains invalid characters',
    },
  });

export class CreateWorkflowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @Matches(/^[a-z0-9]{1,20}$/)
  outputFormat: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  inputFormats?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsWorkflowOutputFilenamePattern()
  outputFilenameTemplate?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  steps: WorkflowStepDto[];
}
