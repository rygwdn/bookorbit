import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

import { KOREADER_DEVICE_ID_REGEX } from '../../koreader/dto/koreader-device-param.dto';

export class WorkflowDeliveryTargetDto {
  @IsIn(['opds', 'koreader'])
  type: 'opds' | 'koreader';

  @ValidateIf((target) => target.type === 'opds')
  @IsInt()
  @Min(1)
  opdsUserId?: number;

  @ValidateIf((target) => target.type === 'koreader')
  @IsString()
  @Matches(KOREADER_DEVICE_ID_REGEX)
  deviceId?: string;
}

export class CreateWorkflowDeliveryPreferenceDto {
  @IsInt()
  @Min(1)
  workflowId: number;

  @ValidateNested()
  @Type(() => WorkflowDeliveryTargetDto)
  target: WorkflowDeliveryTargetDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priority?: number;
}
