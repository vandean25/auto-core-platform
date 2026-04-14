import { IsNotEmpty, IsString } from 'class-validator';

export class CreateWorkshopTaskDto {
  @IsString()
  @IsNotEmpty()
  title!: string;
}
