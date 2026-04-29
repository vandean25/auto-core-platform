import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  InviteTenantMemberDto,
  ListTenantMembersQueryDto,
  TenantMemberResponseDto,
  TenantMembersListResponseDto,
  UpdateTenantMemberDto,
} from './dto/tenant-member.dto';
import { TenantMemberService } from './tenant-member.service';

@ApiTags('tenant-members')
@Controller('tenant-members')
export class TenantMemberController {
  constructor(private readonly tenantMemberService: TenantMemberService) {}

  @Get()
  @ApiOkResponse({ type: TenantMembersListResponseDto })
  findAll(@Query() query: ListTenantMembersQueryDto) {
    return this.tenantMemberService.findAll(query);
  }

  @Post('invite')
  @ApiCreatedResponse({ type: TenantMemberResponseDto })
  invite(@Body() dto: InviteTenantMemberDto) {
    return this.tenantMemberService.invite(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: TenantMemberResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateTenantMemberDto) {
    return this.tenantMemberService.update(id, dto);
  }
}
