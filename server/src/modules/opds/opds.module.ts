import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { registerOpdsProgressionHttp } from './opds-http';
import { OpdsAuthenticationController } from './opds-authentication.controller';
import { OpdsReadingStatsController } from './opds-reading-stats.controller';
import { OpdsProgressionController } from './opds-progression.controller';
import { OpdsProgressionService } from './opds-progression.service';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { ReadingSessionModule } from '../reading-session/reading-session.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AchievementModule } from '../achievement/achievement.module';
import { BookModule } from '../book/book.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { UserModule } from '../user/user.module';
import { CommonModule } from '../../common/common.module';
import { OpdsAuthGuard } from './opds-auth.guard';
import { OpdsBookService } from './opds-book.service';
import { OpdsCollectionRepository } from './opds-collection.repository';
import { Opds2Controller } from './opds2.controller';
import { Opds2Service } from './opds2.service';
import { OpdsController } from './opds.controller';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsService } from './opds.service';
import { OpdsUserController } from './opds-user.controller';
import { OpdsUserService } from './opds-user.service';

@Module({
  imports: [ReadingSessionModule, AppSettingsModule, AchievementModule, BookModule, BookCoverStoreModule, DashboardModule, UserModule, CommonModule],
  controllers: [
    OpdsReadingStatsController,
    OpdsAuthenticationController,
    OpdsProgressionController,
    OpdsController,
    Opds2Controller,
    OpdsUserController,
  ],
  providers: [
    OpdsProgressionService,
    OpdsService,
    Opds2Service,
    OpdsBookService,
    OpdsCollectionRepository,
    OpdsUserService,
    OpdsAuthGuard,
    OpdsEnabledGuard,
  ],
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
