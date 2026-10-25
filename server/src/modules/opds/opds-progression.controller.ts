import { Body, Controller, Get, Header, Param, ParseIntPipe, Put, Query, UseFilters, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { OpdsAuthGuard, type OpdsRequestUser } from './opds-auth.guard';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsUser } from './opds-user.decorator';
import { OpdsProgressionDto } from './dto/opds-progression.dto';
import { OpdsProgressionService } from './opds-progression.service';
import { OpdsProgressionFilter } from './opds-progression.filter';

class ProgressionQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) fileId?: number;
}

@Controller('opds/:bookId/progression')
@Public()
@UseGuards(OpdsEnabledGuard, OpdsAuthGuard)
@UseFilters(OpdsProgressionFilter)
export class OpdsProgressionController {
  constructor(private readonly progression: OpdsProgressionService) {}

  @Get()
  @Header('Content-Type', 'application/opds-progression+json')
  @Header('Cache-Control', 'no-store')
  async get(@OpdsUser() user: OpdsRequestUser, @Param('bookId', ParseIntPipe) bookId: number, @Query() query: ProgressionQueryDto) {
    return (await this.progression.get(user, bookId, query.fileId)) ?? '';
  }

  @Put()
  @Header('Content-Type', 'application/opds-progression+json')
  @Header('Cache-Control', 'no-store')
  put(
    @OpdsUser() user: OpdsRequestUser,
    @Param('bookId', ParseIntPipe) bookId: number,
    @Query() query: ProgressionQueryDto,
    @Body() body: OpdsProgressionDto,
  ) {
    return this.progression.put(user, bookId, body, query.fileId);
  }
}
