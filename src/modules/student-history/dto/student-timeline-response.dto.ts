import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StudentTimelineCategory,
  StudentTimelineType,
} from '@/modules/student-history/student-timeline.enums';

export class TimelineRefDto {
  @ApiProperty({ example: 52 })
  id: number;

  @ApiProperty({ example: 'Pre-inter 16:30' })
  name: string;
}

export class StudentTimelineItemDto {
  @ApiProperty({
    example: 'receipt:1636',
    description: 'Manba va id — barqaror kalit',
  })
  id: string;

  @ApiProperty({ enum: StudentTimelineType })
  type: StudentTimelineType;

  @ApiProperty({ enum: StudentTimelineCategory })
  category: StudentTimelineCategory;

  @ApiProperty({
    example: '2026-10-13T05:31:06.000Z',
    description: "ISO vaqt; `dateOnly` bo'lsa `YYYY-MM-DD`",
  })
  occurredAt: string;

  @ApiProperty({ description: "Faqat sanasi ma'lum (vaqti yo'q) voqea" })
  dateOnly: boolean;

  @ApiPropertyOptional({ type: TimelineRefDto, nullable: true })
  actor: TimelineRefDto | null;

  @ApiPropertyOptional({ type: TimelineRefDto, nullable: true })
  group: TimelineRefDto | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      "Turga xos ma'lumot: amount, status, method, forMonth, fromStatus, toStatus, " +
      'returnLikelihood, comment, reason, fields, fromGroupName, toGroupName, ...',
  })
  details: Record<string, unknown>;
}

export class StudentTimelineResponseDto {
  @ApiProperty({
    type: [StudentTimelineItemDto],
    description: 'Yangidan eskiga',
  })
  items: StudentTimelineItemDto[];
}
