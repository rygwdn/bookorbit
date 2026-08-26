import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt } from 'class-validator';

export class RunWorkflowBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20000)
  @IsInt({ each: true })
  bookIds: number[];
}
