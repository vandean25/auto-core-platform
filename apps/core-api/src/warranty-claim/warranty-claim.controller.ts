import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CreateWarrantyClaimDto,
  ListWarrantyClaimsQueryDto,
  UpdateWarrantyClaimDto,
  WarrantyClaimListResponseDto,
  WarrantyClaimResponseDto,
} from './dto/warranty-claim.dto.js';
import { WarrantyClaimPdfService } from './warranty-claim-pdf.service.js';
import { WarrantyClaimService } from './warranty-claim.service.js';

@ApiTags('Workshop')
@Controller('workshop/orders/:orderId/warranty-claims')
export class WarrantyClaimController {
  constructor(
    private readonly claims: WarrantyClaimService,
    private readonly pdf: WarrantyClaimPdfService,
  ) {}

  @Get()
  @ApiOkResponse({ type: WarrantyClaimListResponseDto })
  list(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() query: ListWarrantyClaimsQueryDto,
  ) {
    return this.claims.list(orderId, query);
  }

  @Post()
  @ApiCreatedResponse({ type: WarrantyClaimResponseDto })
  create(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateWarrantyClaimDto,
  ) {
    return this.claims.create(orderId, dto);
  }

  @Get(':claimId')
  @ApiOkResponse({ type: WarrantyClaimResponseDto })
  get(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
  ) {
    return this.claims.get(orderId, claimId);
  }

  @Patch(':claimId')
  @ApiOkResponse({ type: WarrantyClaimResponseDto })
  update(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: UpdateWarrantyClaimDto,
  ) {
    return this.claims.update(orderId, claimId, dto);
  }

  @Get(':claimId/pdf')
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'Printable Garantie/Kulanz claim summary',
    schema: { type: 'string', format: 'binary' },
  })
  async downloadPdf(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.pdf.render(orderId, claimId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.bytes.length),
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(file.bytes);
  }
}
