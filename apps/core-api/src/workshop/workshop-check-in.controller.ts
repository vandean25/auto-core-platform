import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { MAX_IMAGE_BYTES } from '../mechanic/dto/media.dto.js';
import {
  CompleteWorkshopCheckInDto,
  CreateWorkshopCheckInDto,
  UpdateWorkshopCheckInDto,
  UpdateWorkshopCheckInInspectionDto,
  WorkshopCheckInResponseDto,
} from './dto/workshop-check-in.dto.js';
import { WorkshopInspectionResponseDto } from './dto/workshop-inspection-response.dto.js';
import { WorkshopCheckInService } from './workshop-check-in.service.js';
import { WorkshopCheckInMediaService } from './workshop-check-in-media.service.js';
import {
  UploadWorkshopCheckInMediaBodyDto,
  WorkshopCheckInMediaItemDto,
  WorkshopCheckInMediaListDto,
} from './dto/workshop-check-in-media.dto.js';
import { WorkshopInspectionService } from './workshop-inspection.service.js';

@ApiTags('Workshop')
@Controller('workshop/orders/:orderId/check-in')
export class WorkshopCheckInController {
  constructor(
    private readonly checkIns: WorkshopCheckInService,
    private readonly checkInMedia: WorkshopCheckInMediaService,
    private readonly inspections: WorkshopInspectionService,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: WorkshopCheckInResponseDto })
  @ApiOkResponse({
    type: WorkshopCheckInResponseDto,
    description: 'Idempotent retry when the same check-in id already exists.',
  })
  async create(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateWorkshopCheckInDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkshopCheckInResponseDto> {
    const result = await this.checkIns.create(orderId, dto);
    res.status(result.created ? 201 : 200);
    return result.body;
  }

  @Get()
  @ApiOkResponse({ type: WorkshopCheckInResponseDto })
  get(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<WorkshopCheckInResponseDto> {
    return this.checkIns.get(orderId);
  }

  @Patch()
  @ApiOkResponse({ type: WorkshopCheckInResponseDto })
  updateDraft(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateWorkshopCheckInDto,
  ): Promise<WorkshopCheckInResponseDto> {
    return this.checkIns.updateDraft(orderId, dto);
  }

  @Get('inspection')
  @ApiOkResponse({ type: WorkshopInspectionResponseDto })
  getInspection(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<WorkshopInspectionResponseDto> {
    return this.inspections.getOrderCheckInChecklist(orderId);
  }

  @Patch('inspection')
  @ApiOkResponse({ type: WorkshopInspectionResponseDto })
  updateInspection(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateWorkshopCheckInInspectionDto,
  ): Promise<WorkshopInspectionResponseDto> {
    const { expected_revision, items } = dto;
    return this.inspections.updateOrderCheckInChecklist(
      orderId,
      expected_revision,
      {
        items,
      },
    );
  }

  @Get('media')
  @ApiOkResponse({ type: WorkshopCheckInMediaListDto })
  listMedia(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<WorkshopCheckInMediaListDto> {
    return this.checkInMedia.list(orderId);
  }

  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadWorkshopCheckInMediaBodyDto })
  @ApiCreatedResponse({ type: WorkshopCheckInMediaItemDto })
  @ApiOkResponse({ type: WorkshopCheckInMediaItemDto })
  async uploadMedia(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('client_upload_id') clientUploadId: string,
    @Body('purpose') purpose: string,
    @Body('expected_revision', ParseIntPipe) expectedRevision: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkshopCheckInMediaItemDto> {
    const result = await this.checkInMedia.upload(orderId, {
      file,
      clientUploadId,
      purpose,
      expectedRevision,
    });
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.item;
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkshopCheckInResponseDto })
  complete(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CompleteWorkshopCheckInDto,
  ): Promise<WorkshopCheckInResponseDto> {
    return this.checkIns.complete(orderId, dto);
  }
}
