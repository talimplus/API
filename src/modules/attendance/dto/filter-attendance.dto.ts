import { IsOptional, IsDateString } from 'class-validator';

export class FilterAttendanceDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  groupId?: number;

  @IsOptional()
  studentId?: number;
}
