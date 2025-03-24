import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  centerId?: number;
}
