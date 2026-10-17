import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { VehicleMediaService } from './vehicle-media.service.js';
import {
  ReorderVehicleMediaDto,
  VehicleMediaDto,
} from './dto/vehicle-media.dto.js';
import { VEHICLE_MEDIA_MAX_UPLOAD_BYTES } from './vehicle-media-upload.rules.js';

@ApiTags('vehicle-stock')
@Controller('vehicle-stock/:vehicleId/photos')
export class VehicleMediaController {
  constructor(private readonly photos: VehicleMediaService) {}

  @Get()
  @ApiOperation({ summary: 'List vehicle stock photos in display order' })
  @ApiOkResponse({ type: [VehicleMediaDto] })
  list(@Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.photos.list(vehicleId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: VEHICLE_MEDIA_MAX_UPLOAD_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a vehicle stock photo (processed variants)',
  })
  @ApiCreatedResponse({ type: VehicleMediaDto })
  upload(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.photos.upload(vehicleId, file);
  }

  @Put('reorder')
  @ApiOperation({ summary: 'Reorder all photos for a vehicle' })
  @ApiOkResponse({ type: [VehicleMediaDto] })
  reorder(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: ReorderVehicleMediaDto,
  ) {
    return this.photos.reorder(vehicleId, dto.mediaIds);
  }

  @Post(':photoId/set-cover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set the cover photo for a vehicle' })
  @ApiOkResponse({ type: VehicleMediaDto })
  setCover(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    return this.photos.setCover(vehicleId, photoId);
  }

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a vehicle stock photo' })
  @ApiNoContentResponse()
  async remove(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    await this.photos.remove(vehicleId, photoId);
  }
}
