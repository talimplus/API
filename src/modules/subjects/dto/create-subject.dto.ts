import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateSubjectDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  centerId: number;
}
