import { IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class CreateGroupDto {
  @IsNotEmpty()
  name: string;

  @IsNumber()
  subjectId: number;

  @IsNumber()
  centerId: number;

  @IsOptional()
  @IsNumber()
  teacherId?: number;
}
