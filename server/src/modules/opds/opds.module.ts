import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { DashboardModule } from '../dashboard/dashboard.module';
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
  imports: [AppSettingsModule, BookModule, BookCoverStoreModule, DashboardModule, UserModule, CommonModule],
  controllers: [OpdsController, Opds2Controller, OpdsUserController],
  providers: [OpdsService, Opds2Service, OpdsBookService, OpdsCollectionRepository, OpdsUserService, OpdsAuthGuard, OpdsEnabledGuard],
  exports: [OpdsBookService],
})
export class OpdsModule {}
