import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import { RegistrationIntakeService } from './registration-intake.service.js';
import { RegistrationIntakeUploadInterceptor } from './registration-intake-upload.interceptor.js';
import {
  REGISTRATION_INTAKE_MAX_BYTES_PER_FILE,
  REGISTRATION_INTAKE_MAX_FILES,
} from './registration-intake-limits.js';
import { ApplyRegistrationIntakeDto } from './dto/apply-registration-intake.dto.js';
import { CreateRegistrationIntakeOrderDto } from './dto/create-registration-intake-order.dto.js';
import { registrationIdMismatch } from './registration-intake.errors.js';
import {
  coerceRegistrationIntakeSides,
  coerceRegistrationIntakeUploadFiles,
} from './registration-intake-upload.validation.js';

@ApiTags('workshop')
@ApiBearerAuth()
@Controller('workshop/registration-intakes')
export class RegistrationIntakeController {
  constructor(private readonly registrationIntake: RegistrationIntakeService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseInterceptors(
    RegistrationIntakeUploadInterceptor,
    FilesInterceptor('files', REGISTRATION_INTAKE_MAX_FILES, {
      limits: { fileSize: REGISTRATION_INTAKE_MAX_BYTES_PER_FILE },
    }),
  )
  create(
    @UploadedFiles() filesRaw: unknown,
    @Body('sides') sidesRaw: unknown,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const files = coerceRegistrationIntakeUploadFiles(filesRaw);
    const sides = coerceRegistrationIntakeSides(sidesRaw, files.length);
    return this.registrationIntake.create(
      files,
      sides,
      typeof idempotencyKey === 'string' ? idempotencyKey : '',
    );
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.registrationIntake.get(id);
  }

  @Post(':id/apply')
  apply(@Param('id') id: string, @Body() dto: ApplyRegistrationIntakeDto) {
    if (dto.intakeId && dto.intakeId !== id) {
      throw registrationIdMismatch();
    }
    return this.registrationIntake.apply(id, dto);
  }

  @Post(':id/order')
  order(
    @Param('id') id: string,
    @Body() dto: CreateRegistrationIntakeOrderDto,
  ) {
    return this.registrationIntake.createOrder(id, dto);
  }

  @Post(':id/abort')
  abort(@Param('id') id: string) {
    return this.registrationIntake.abort(id);
  }

  @Post(':id/purge-bytes')
  purgeBytes(@Param('id') id: string) {
    return this.registrationIntake.purgeBytes(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.registrationIntake.delete(id);
  }
}
