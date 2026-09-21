import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { TopicDifficulty } from './enums/topic-difficulty.enum';

export type DistributedLesson = {
  lessonNumber: number;
  topicIds: number[];
};

export type GeneratedTopicContent = {
  guide: string;
  lessonOutline: string;
  homework: string;
};

export type AiChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AiPlanDraftTopic = {
  title: string;
  description?: string;
  difficulty: TopicDifficulty;
  estimatedLessons: number;
};

export type AiPlanDraft = {
  name: string;
  description?: string;
  totalLessons?: number;
  topics: AiPlanDraftTopic[];
};

export type CoursePlanChatResult =
  | { type: 'question'; message: string }
  | { type: 'plan'; message: string; plan: AiPlanDraft };

@Injectable()
export class LessonAiService {
  private readonly logger = new Logger(LessonAiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  private getClient(): OpenAI {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'AI xizmati sozlanmagan (OPENAI_API_KEY topilmadi)',
      );
    }
    return this.client;
  }

  private async completeJson(
    system: string,
    user: string | AiChatMessage[],
  ): Promise<any> {
    const client = this.getClient();
    const history: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[] = typeof user === 'string' ? [{ role: 'user', content: user }] : user;

    const response = await client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, ...history],
    });

    const raw = response.choices[0]?.message?.content ?? '';
    try {
      return JSON.parse(raw);
    } catch (e) {
      this.logger.error(`AI JSON parse xatosi: ${raw.slice(0, 500)}`);
      throw new ServiceUnavailableException(
        "AI javobini o'qib bo'lmadi, qayta urinib ko'ring",
      );
    }
  }

  /**
   * Chat orqali kurs rejasini tuzadi. Ma'lumot yetishmasa savol qaytaradi,
   * yetarli bo'lsa to'liq reja qoralamasini qaytaradi (bazaga saqlamaydi).
   */
  async chatCoursePlan(params: {
    messages: AiChatMessage[];
    subjectName?: string;
  }): Promise<CoursePlanChatResult> {
    const { messages, subjectName } = params;

    const system = [
      "Sen o'quv markazi uchun kurs rejasini (mavzular ro'yxatini) tuzuvchi AI yordamchisan.",
      "Foydalanuvchi bilan o'zbek tilida suhbatlashib, kurs rejasini tuzasan.",
      '',
      "Reja tuzishdan oldin quyidagi ma'lumotlar aniq bo'lishi kerak:",
      "1. Yo'nalish va qamrov — qaysi kurs/fan, unda nimalar o'rgatiladi (masalan frontend bo'lsa: HTML, CSS, JS, TypeScript kiradimi va h.k.).",
      "2. Jami darslar soni. Foydalanuvchi buni bevosita aytmasligi mumkin — u holda kurs davomiyligi (necha oy) VA haftasiga necha kun dars bo'lishini so'rab, o'zing hisoblaysan: jami darslar ≈ oylar soni × 4 hafta × haftadagi darslar soni.",
      '',
      'Qoidalar:',
      "- Muhim ma'lumot yetishmasa, qisqa va aniq savol ber. Bir xabarda bir-ikkitadan ortiq savol berma, keraksiz narsani so'rama.",
      "- Auditoriya darajasi kabi ikkinchi darajali detallar aytilmasa, o'zing oqilona taxmin qil — qayta so'rab o'tirma.",
      "- Ma'lumot yetarli bo'lgach reja tuz: mavzular mantiqiy ketma-ketlikda, soddadan murakkabga, amaliy mashg'ulotlar va oraliq loyiha/imtihonlar bilan.",
      '- Har mavzuga difficulty (easy, medium yoki hard) va estimatedLessons (mavzu nechta dars egallashi) belgila.',
      "- Barcha mavzular estimatedLessons yig'indisi jami darslar soniga teng yoki undan 1-3 dars kam bo'lsin (takrorlash uchun zaxira).",
      "- Faqat o'zbek tilida javob ber.",
      '',
      'Javobni FAQAT quyidagi ikki JSON formatdan birida qaytar:',
      "Savol bo'lsa:",
      '{"type": "question", "message": "savol matni"}',
      "Reja tayyor bo'lsa:",
      '{"type": "plan", "message": "reja haqida 1-2 gaplik izoh", "plan": {"name": "kurs rejasi nomi", "description": "qisqacha tavsif", "totalLessons": 48, "topics": [{"title": "mavzu nomi", "description": "qisqacha izoh", "difficulty": "easy", "estimatedLessons": 2}]}}',
      subjectName ? `\nKurs bog'lanadigan fan: ${subjectName}` : '',
    ].join('\n');

    const parsed = await this.completeJson(system, messages);

    if (parsed?.type === 'plan') {
      const plan = this.sanitizePlanDraft(parsed?.plan);
      if (!plan) {
        throw new ServiceUnavailableException(
          "AI reja tuzib bera olmadi, qayta urinib ko'ring",
        );
      }
      return {
        type: 'plan',
        message: String(parsed?.message ?? 'Reja tayyor.'),
        plan,
      };
    }

    const message = String(parsed?.message ?? '').trim();
    if (!message) {
      throw new ServiceUnavailableException(
        "AI javobini o'qib bo'lmadi, qayta urinib ko'ring",
      );
    }
    return { type: 'question', message };
  }

  /**
   * AI qaytargan reja qoralamasini tozalaydi: bo'sh mavzularni tashlaydi,
   * difficulty/estimatedLessons qiymatlarini chegaraga keltiradi.
   */
  private sanitizePlanDraft(raw: any): AiPlanDraft | null {
    const name = String(raw?.name ?? '').trim();
    const rawTopics = Array.isArray(raw?.topics) ? raw.topics : [];

    const difficulties = new Set<string>(Object.values(TopicDifficulty));
    const topics: AiPlanDraftTopic[] = [];
    for (const t of rawTopics) {
      const title = String(t?.title ?? '').trim();
      if (!title) continue;

      const difficulty = difficulties.has(t?.difficulty)
        ? (t.difficulty as TopicDifficulty)
        : TopicDifficulty.MEDIUM;

      const estimated = Number(t?.estimatedLessons);
      const estimatedLessons =
        Number.isInteger(estimated) && estimated >= 1
          ? Math.min(estimated, 50)
          : 1;

      const description = String(t?.description ?? '').trim();
      topics.push({
        title,
        description: description || undefined,
        difficulty,
        estimatedLessons,
      });
    }

    if (!name || !topics.length) return null;

    const totalLessons = Number(raw?.totalLessons);
    const description = String(raw?.description ?? '').trim();

    return {
      name,
      description: description || undefined,
      totalLessons:
        Number.isInteger(totalLessons) && totalLessons >= 1
          ? totalLessons
          : undefined,
      topics,
    };
  }

  /**
   * Mavzularni guruhning jami darslariga taqsimlaydi.
   * Qiyin mavzularga ko'proq dars, oson/kichik mavzularni bitta darsga birlashtiradi.
   */
  async distributeTopics(params: {
    syllabusName: string;
    subjectName: string;
    totalLessons: number;
    topics: SyllabusTopic[];
    instructions?: string;
  }): Promise<DistributedLesson[]> {
    const { syllabusName, subjectName, totalLessons, topics, instructions } =
      params;

    const topicList = topics.map((t) => ({
      id: t.id,
      title: t.title,
      difficulty: t.difficulty,
      estimatedLessons: t.estimatedLessons,
      description: t.description ?? undefined,
    }));

    const system = [
      "Sen o'quv markazi uchun dars rejalashtiruvchi yordamchisan.",
      'Berilgan kurs mavzularini belgilangan darslar soniga teng va mantiqiy taqsimlab berasan.',
      'Qoidalar:',
      "- Mavzular tartibini saqla (id tartibi emas, berilgan ro'yxat tartibi).",
      "- Qiyin (hard) mavzularga ko'proq dars ajrat, oson (easy) va kichik mavzularni bitta darsga birlashtirishing mumkin.",
      "- estimatedLessons maydoni mavzu odatda nechta dars egallashiga ishora, lekin jami darslar soniga sig'dirish uchun moslashtir.",
      "- Har bir dars kamida bitta mavzuga ega bo'lishi shart emas (takrorlash/imtihon darslari bo'sh qolishi mumkin), lekin barcha mavzular qamrab olinishi shart.",
      'Faqat quyidagi JSON formatda javob ber:',
      '{"lessons": [{"lessonNumber": 1, "topicIds": [12]}, {"lessonNumber": 2, "topicIds": [13, 14]}]}',
    ].join('\n');

    const user = JSON.stringify({
      subject: subjectName,
      course: syllabusName,
      totalLessons,
      topics: topicList,
      additionalInstructions: instructions ?? null,
    });

    const parsed = await this.completeJson(system, user);

    const validTopicIds = new Set(topics.map((t) => t.id));
    const lessons: DistributedLesson[] = Array.isArray(parsed?.lessons)
      ? parsed.lessons
      : [];

    const cleaned: DistributedLesson[] = [];
    const usedTopicIds = new Set<number>();
    for (const l of lessons) {
      const lessonNumber = Number(l?.lessonNumber);
      if (!Number.isInteger(lessonNumber)) continue;
      if (lessonNumber < 1 || lessonNumber > totalLessons) continue;

      const topicIds = (Array.isArray(l?.topicIds) ? l.topicIds : [])
        .map((id: any) => Number(id))
        .filter((id: number) => validTopicIds.has(id) && !usedTopicIds.has(id));
      topicIds.forEach((id: number) => usedTopicIds.add(id));

      if (topicIds.length) cleaned.push({ lessonNumber, topicIds });
    }

    // AI tashlab ketgan mavzularni oxirgi darslarga qo'shib qo'yamiz
    const missing = topics.filter((t) => !usedTopicIds.has(t.id));
    if (missing.length) {
      const lastNumber = cleaned.length
        ? Math.max(...cleaned.map((l) => l.lessonNumber))
        : 0;
      missing.forEach((t, i) => {
        const lessonNumber = Math.min(totalLessons, lastNumber + i + 1);
        const existing = cleaned.find((l) => l.lessonNumber === lessonNumber);
        if (existing) existing.topicIds.push(t.id);
        else cleaned.push({ lessonNumber, topicIds: [t.id] });
      });
    }

    return cleaned.sort((a, b) => a.lessonNumber - b.lessonNumber);
  }

  /**
   * Mavzu uchun qo'llanma, dars rejasi va uy vazifasi qoralamasini yaratadi.
   */
  async generateTopicContent(params: {
    subjectName: string;
    syllabusName: string;
    topicTitle: string;
    topicDescription?: string | null;
    audience?: string;
    instructions?: string;
  }): Promise<GeneratedTopicContent> {
    const system = [
      "Sen tajribali o'qituvchi-metodist yordamchisan.",
      "Berilgan mavzu uchun o'zbek tilida, markdown formatida uchta material tayyorlaysan:",
      "1. guide — o'qituvchi uchun qo'llanma: mavzuni qanday tushuntirish, e'tibor beriladigan nuqtalar, ko'p uchraydigan xatolar.",
      '2. lessonOutline — dars rejasi: darsning bosqichma-bosqich borishi (kirish, yangi mavzu, mashqlar, yakun).',
      '3. homework — uyga vazifa: aniq topshiriqlar.',
      'Faqat quyidagi JSON formatda javob ber:',
      '{"guide": "...", "lessonOutline": "...", "homework": "..."}',
    ].join('\n');

    const user = JSON.stringify({
      subject: params.subjectName,
      course: params.syllabusName,
      topic: params.topicTitle,
      topicDescription: params.topicDescription ?? null,
      audience: params.audience ?? null,
      additionalInstructions: params.instructions ?? null,
    });

    const parsed = await this.completeJson(system, user);

    return {
      guide: String(parsed?.guide ?? ''),
      lessonOutline: String(parsed?.lessonOutline ?? ''),
      homework: String(parsed?.homework ?? ''),
    };
  }
}
