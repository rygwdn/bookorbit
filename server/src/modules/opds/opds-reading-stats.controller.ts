import { Body, Controller, Header, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { OPDS_READING_STATS_TYPE } from '@bookorbit/types';

import { Public } from '../../common/decorators/public.decorator';
import { ReadingSessionService } from '../reading-session/reading-session.service';
import { OpdsAuthGuard, type OpdsRequestUser } from './opds-auth.guard';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsUser } from './opds-user.decorator';
import { OpdsReadingStatsDto, OpdsReadingStatsQueryDto } from './dto/opds-reading-stats.dto';

@Controller('opds/:bookId/stats')
@Public()
@UseGuards(OpdsEnabledGuard, OpdsAuthGuard)
export class OpdsReadingStatsController {
  constructor(private readonly sessions: ReadingSessionService) {}

  @Post()
  @HttpCode(200)
  @Header('Content-Type', OPDS_READING_STATS_TYPE)
  @Header('Cache-Control', 'no-store')
  async post(
    @OpdsUser() user: OpdsRequestUser,
    @Param('bookId', ParseIntPipe) bookId: number,
    @Query() query: OpdsReadingStatsQueryDto,
    @Body() body: OpdsReadingStatsDto,
  ) {
    return this.sessions.saveOpdsBatch(bookId, query.fileId, body, user.account);
  }
}
