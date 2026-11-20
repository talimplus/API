import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, Min } from 'class-validator';

/** Bitta guruhdagi shaxsiy narx (forma). 0 — guruh narxi. */
export class GroupFeeDto {
  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  groupId: number;

  @ApiProperty({ example: 350000, description: '0 — guruh narxi' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyFee: number;
}
