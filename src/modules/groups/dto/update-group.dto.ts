import { IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateGroupDto {
  @ApiProperty({
    example: 'Frontend guruxi',
    description: 'Gurux nomi',
    required: false,
  })
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: 2,
    description: 'Tanlangan fan idsi',
    required: false,
  })
  @IsNumber()
  subjectId?: number;

  @ApiProperty({
    example: 2,
    description: "Guruxga biriktirilgan o'qituvchi idsi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  teacherId?: number;

  @ApiProperty({
    example: 400000,
    description: "Bu guruxdagi o'quvchilarning default oylik to'lovi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  monthlyFee?: number;

  @ApiProperty({
    example: 3,
    description:
      "Gurux qaysi centerga qo'shilayotgani, centerId faqat admin gurux yaratayotganda yuboriladi boshqa vaqt kerak emas",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  centerId?: number;
}
