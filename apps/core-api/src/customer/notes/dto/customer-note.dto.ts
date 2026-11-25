import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerNoteRetentionClass, TenantMemberRole } from '@prisma/client';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateCustomerNoteDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  invoice_id?: string;
}

export class UpdateCustomerNoteDto {
  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class PinCustomerNoteDto {
  @ApiProperty()
  @IsBoolean()
  pinned!: boolean;
}

export class CustomerNoteResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customer_id!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  pinned!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  author_member_id!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: TenantMemberRole,
    enumName: 'TenantMemberRole',
  })
  author_role!: TenantMemberRole | null;

  @ApiProperty({
    enum: CustomerNoteRetentionClass,
    enumName: 'CustomerNoteRetentionClass',
  })
  retention_class!: CustomerNoteRetentionClass;

  @ApiProperty()
  retain_until!: Date;

  @ApiProperty()
  legal_hold!: boolean;

  @ApiProperty()
  created_at!: Date;

  @ApiProperty()
  updated_at!: Date;
}

export class CustomerNoteListResponseDto {
  @ApiProperty({ type: [CustomerNoteResponseDto] })
  data!: CustomerNoteResponseDto[];
}
