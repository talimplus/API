import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudentEvent } from '@/modules/student-history/entities/student-event.entity';
import { StudentEventType } from '@/modules/student-history/student-timeline.enums';

export interface LogStudentEventInput {
  studentId: number;
  organizationId: number;
  type: StudentEventType;
  actorId?: number | null;
  groupId?: number | null;
  payload?: Record<string, unknown>;
}

/**
 * `student_events` jurnaliga yozadi.
 *
 * **Hech qachon xato tashlamaydi**: tarix — ikkinchi darajali ma'lumot, u
 * yozilmay qolsa ham holat o'zgarishi / ko'chirish / tahrir to'xtamasligi
 * kerak (Telegram bildirishnomalari bilan bir xil tamoyil).
 */
@Injectable()
export class StudentEventsService {
  private readonly logger = new Logger(StudentEventsService.name);

  constructor(
    @InjectRepository(StudentEvent)
    private readonly eventRepo: Repository<StudentEvent>,
  ) {}

  async log(input: LogStudentEventInput): Promise<void> {
    try {
      await this.eventRepo.insert({
        studentId: input.studentId,
        organizationId: input.organizationId,
        type: input.type,
        actorId: input.actorId ?? null,
        groupId: input.groupId ?? null,
        payload: input.payload ?? {},
      });
    } catch (e) {
      this.logger.warn(
        `student_events yozilmadi (student ${input.studentId}, ${input.type}): ${
          (e as Error).message
        }`,
      );
    }
  }
}
