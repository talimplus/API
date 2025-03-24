import { IsOptional } from 'class-validator';

export class UpdateCenterDto {
  @IsOptional()
  name?: string;
}
