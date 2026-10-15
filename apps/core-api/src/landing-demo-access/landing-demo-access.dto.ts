import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LandingDemoAccessRequestDto {
  @ApiProperty({ example: 'Maria Muster' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'Autowerkstatt Muster GmbH' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  betrieb!: string;

  @ApiProperty({ example: 'demo@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional({ example: '+43 660 1234567' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  telefon?: string;

  @ApiPropertyOptional({ example: 'Wir möchten die Werkstattsoftware testen.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  nachricht?: string;

  @ApiProperty({ description: 'Must be true (GDPR consent).' })
  @IsBoolean()
  @Equals(true)
  consent!: boolean;

  @ApiPropertyOptional({
    description: 'Honeypot field; must be empty.',
    example: '',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @ApiPropertyOptional({
    description: 'Cloudflare Turnstile token when captcha is enabled.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}

export class LandingDemoAccessOkDto {
  @ApiProperty({ example: true })
  ok!: true;
}
