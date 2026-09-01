import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  CreateLegalEntityDto,
  CreateSiteDto,
  CreateSiteMembershipDto,
  UpdateSiteDto,
} from './dto/site.dto';
import { SiteService } from './site.service';

@ApiTags('legal-entities')
@Controller('legal-entities')
export class LegalEntityController {
  constructor(private readonly siteService: SiteService) {}

  @Get()
  @ApiOperation({
    summary: 'List legal entities (OWNER/ADMIN, includes inactive by default)',
  })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  listLegalEntities(@Query('includeInactive') includeInactive?: string) {
    // Ruling 53: GET /api/legal-entities includes inactive entities unless the
    // caller explicitly hides them with includeInactive=false.
    return this.siteService.listLegalEntities(includeInactive !== 'false');
  }

  @Post()
  @ApiOperation({ summary: 'Create a legal entity (OWNER/ADMIN)' })
  createLegalEntity(@Body() dto: CreateLegalEntityDto) {
    return this.siteService.createLegalEntity(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a legal entity (OWNER/ADMIN)' })
  updateLegalEntity(
    @Param('id') id: string,
    @Body() dto: { name?: string; isActive?: boolean },
  ) {
    return this.siteService.updateLegalEntity(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hard-delete an unused legal entity (OWNER/ADMIN)' })
  deleteLegalEntity(@Param('id') id: string) {
    return this.siteService.deleteLegalEntity(id);
  }
}

@ApiTags('sites')
@Controller('sites')
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  @Get()
  @ApiOperation({ summary: 'Active site directory or full list (OWNER/ADMIN)' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  listSites(@Query('includeInactive') includeInactive?: string) {
    return this.siteService.listSites(includeInactive === 'true');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single site' })
  getSite(@Param('id') id: string) {
    return this.siteService.getSite(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a site (OWNER/ADMIN)' })
  createSite(@Body() dto: CreateSiteDto) {
    return this.siteService.createSite(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a site (OWNER/ADMIN)' })
  updateSite(@Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.siteService.updateSite(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hard-delete a pristine site (OWNER/ADMIN)' })
  deleteSite(@Param('id') id: string) {
    return this.siteService.deleteSite(id);
  }

  @Get(':id/memberships')
  @ApiOperation({ summary: 'List site memberships' })
  listSiteMemberships(@Param('id') id: string) {
    return this.siteService.listSiteMemberships(id);
  }

  @Post(':id/memberships')
  @ApiOperation({ summary: 'Add a site membership (OWNER/ADMIN)' })
  addSiteMembership(
    @Param('id') id: string,
    @Body() dto: CreateSiteMembershipDto,
  ) {
    return this.siteService.addSiteMembership(id, dto);
  }

  @Delete(':id/memberships/:userId')
  @ApiOperation({ summary: 'Remove a site membership (OWNER/ADMIN)' })
  removeSiteMembership(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.siteService.removeSiteMembership(id, userId);
  }
}
