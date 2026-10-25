import { ReadingSessionModule } from '../reading-session/reading-session.module';
import { OpdsReadingStatsController } from './opds-reading-stats.controller';
import { OpdsAuthenticationController } from './opds-authentication.controller';
import { DashboardModule } from '../dashboard/dashboard.module';
import { Opds2Controller } from './opds2.controller';
import { Opds2Service } from './opds2.service';
import { OpdsProgressionController } from './opds-progression.controller';
import { OpdsProgressionService } from './opds-progression.service';
import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { CommonModule } from '../../common/common.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { UserModule } from '../user/user.module';
import { OpdsAuthGuard } from './opds-auth.guard';
import { OpdsBookService } from './opds-book.service';
import { OpdsController } from './opds.controller';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsModule } from './opds.module';
import { OpdsService } from './opds.service';
import { OpdsUserController } from './opds-user.controller';
import { OpdsUserService } from './opds-user.service';

describe('OpdsModule', () => {
  it('registers expected module wiring', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, OpdsModule)).toEqual([
      ReadingSessionModule,
      DashboardModule,
      AppSettingsModule,
      BookModule,
      UserModule,
      CommonModule,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, OpdsModule)).toEqual([
      OpdsReadingStatsController,
      OpdsAuthenticationController,
      OpdsProgressionController,
      Opds2Controller,
      OpdsController,
      OpdsUserController,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, OpdsModule)).toEqual([
      OpdsProgressionService,
      Opds2Service,
      OpdsService,
      OpdsBookService,
      OpdsUserService,
      OpdsAuthGuard,
      OpdsEnabledGuard,
    ]);
  });
});
