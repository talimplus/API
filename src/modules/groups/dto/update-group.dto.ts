import { IsOptional, IsString, IsNumber } from 'class-validator';

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  subjectId?: number;

  @IsOptional()
  @IsNumber()
  centerId?: number;

  @IsOptional()
  @IsNumber()
  teacherId?: number;
}
