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

@ApiTags('sites')
@Controller()
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  // -------------------------------------------------------------------------
  // Legal entities
  // -------------------------------------------------------------------------

  @Get('api/legal-entities')
  @ApiOperation({ summary: 'List legal entities (OWNER/ADMIN)' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  listLegalEntities(@Query('includeInactive') includeInactive?: string) {
    return this.siteService.listLegalEntities(includeInactive === 'true');
  }

  @Post('api/legal-entities')
  @ApiOperation({ summary: 'Create a legal entity (OWNER/ADMIN)' })
  createLegalEntity(@Body() dto: CreateLegalEntityDto) {
    return this.siteService.createLegalEntity(dto);
  }

  @Patch('api/legal-entities/:id')
  @ApiOperation({ summary: 'Update a legal entity (OWNER/ADMIN)' })
  updateLegalEntity(
    @Param('id') id: string,
    @Body() dto: { name?: string; isActive?: boolean },
  ) {
    return this.siteService.updateLegalEntity(id, dto);
  }

  @Delete('api/legal-entities/:id')
  @ApiOperation({ summary: 'Hard-delete an unused legal entity (OWNER/ADMIN)' })
  deleteLegalEntity(@Param('id') id: string) {
    return this.siteService.deleteLegalEntity(id);
  }

  // -------------------------------------------------------------------------
  // Sites
  // -------------------------------------------------------------------------

  @Get('api/sites')
  @ApiOperation({ summary: 'Active site directory or full list (OWNER/ADMIN)' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  listSites(@Query('includeInactive') includeInactive?: string) {
    return this.siteService.listSites(includeInactive === 'true');
  }

  @Get('api/sites/:id')
  @ApiOperation({ summary: 'Get a single site' })
  getSite(@Param('id') id: string) {
    return this.siteService.getSite(id);
  }

  @Post('api/sites')
  @ApiOperation({ summary: 'Create a site (OWNER/ADMIN)' })
  createSite(@Body() dto: CreateSiteDto) {
    return this.siteService.createSite(dto);
  }

  @Patch('api/sites/:id')
  @ApiOperation({ summary: 'Update a site (OWNER/ADMIN)' })
  updateSite(@Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.siteService.updateSite(id, dto);
  }

  @Delete('api/sites/:id')
  @ApiOperation({ summary: 'Hard-delete a pristine site (OWNER/ADMIN)' })
  deleteSite(@Param('id') id: string) {
    return this.siteService.deleteSite(id);
  }

  // -------------------------------------------------------------------------
  // Site memberships
  // -------------------------------------------------------------------------

  @Get('api/sites/:id/memberships')
  @ApiOperation({ summary: 'List site memberships' })
  listSiteMemberships(@Param('id') id: string) {
    return this.siteService.listSiteMemberships(id);
  }

  @Post('api/sites/:id/memberships')
  @ApiOperation({ summary: 'Add a site membership (OWNER/ADMIN)' })
  addSiteMembership(
    @Param('id') id: string,
    @Body() dto: CreateSiteMembershipDto,
  ) {
    return this.siteService.addSiteMembership(id, dto);
  }

  @Delete('api/sites/:id/memberships/:userId')
  @ApiOperation({ summary: 'Remove a site membership (OWNER/ADMIN)' })
  removeSiteMembership(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.siteService.removeSiteMembership(id, userId);
  }
}
