import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SearchController } from './search.controller.js';
import { createSearchProviders } from './search-providers.js';
import { SearchService } from './search.service.js';
import { SEARCH_PROVIDERS } from './search.types.js';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [
    {
      provide: SEARCH_PROVIDERS,
      useFactory: createSearchProviders,
      inject: [PrismaService],
    },
    SearchService,
  ],
})
export class SearchModule {}
