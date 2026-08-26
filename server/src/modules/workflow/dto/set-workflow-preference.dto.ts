import { IsInt, ValidateIf } from 'class-validator';

export class SetWorkflowPreferenceDto {
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  workflowId: number | null;
}
