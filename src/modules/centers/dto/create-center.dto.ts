import { IsNotEmpty } from 'class-validator';

export class CreateCenterDto {
  @IsNotEmpty()
  name: string;
}
