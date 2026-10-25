import { ReadingSessionModule } from '../reading-session/reading-session.module';
import { OpdsReadingStatsController } from './opds-reading-stats.controller';
import { OpdsAuthenticationController } from './opds-authentication.controller';
import { registerOpdsProgressionHttp } from './opds-http';
import { OpdsProgressionController } from './opds-progression.controller';
import { OpdsProgressionService } from './opds-progression.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { Opds2Service } from './opds2.service';
import { Opds2Controller } from './opds2.controller';
import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { UserModule } from '../user/user.module';
import { CommonModule } from '../../common/common.module';
import { OpdsAuthGuard } from './opds-auth.guard';
import { OpdsBookService } from './opds-book.service';
import { OpdsController } from './opds.controller';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsService } from './opds.service';
import { OpdsUserController } from './opds-user.controller';
import { OpdsUserService } from './opds-user.service';

@Module({
  imports: [ReadingSessionModule, DashboardModule, AppSettingsModule, BookModule, UserModule, CommonModule],
  controllers: [
    OpdsReadingStatsController,
    OpdsAuthenticationController,
    OpdsProgressionController,
    Opds2Controller,
    OpdsController,
    OpdsUserController,
  ],
  providers: [OpdsProgressionService, Opds2Service, OpdsService, OpdsBookService, OpdsUserService, OpdsAuthGuard, OpdsEnabledGuard],
  exports: [OpdsBookService],
})
export class OpdsModule implements OnModuleInit {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onModuleInit() {
    const adapter = this.adapterHost.httpAdapter;
    if (!adapter || adapter.getType() !== 'fastify') return;
    const fastify = adapter.getInstance<FastifyInstance>();
    registerOpdsProgressionHttp(fastify);
  }
}
