import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWorkshopTaskDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;
}
