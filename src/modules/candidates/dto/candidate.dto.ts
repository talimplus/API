import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CandidatePosition } from '@/modules/candidates/enums/candidate-position.enum';
import { CandidateStatus } from '@/modules/candidates/enums/candidate-status.enum';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Bo'sh satr — "olib tashlash" (null). */
const trimOrNull = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  const s = String(value).trim();
  return s ? s : null;
};

export class CreateCandidateDto {
  @ApiProperty({ example: 'Aliyev' })
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  @IsNotEmpty({ message: 'Familiya majburiy' })
  lastName: string;

  @ApiProperty({ example: 'Vali' })
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  @IsNotEmpty({ message: 'Ism majburiy' })
  firstName: string;

  @ApiProperty({ example: '+998901234567' })
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  @IsNotEmpty({ message: 'Telefon majburiy' })
  phone: string;

  @ApiProperty({ example: '3 yil, 21-maktabda ingliz tili o‘qituvchisi' })
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  @IsNotEmpty({ message: 'Tajriba majburiy' })
  experience: string;

  @ApiProperty({ example: 1995 })
  @Type(() => Number)
  @Min(1940, { message: "Tug'ilgan yil noto'g'ri" })
  @IsInt({ message: "Tug'ilgan yil butun son bo'lishi kerak" })
  birthYear: number;

  @ApiProperty({ enum: CandidatePosition, example: CandidatePosition.TEACHER })
  @IsEnum(CandidatePosition, { message: 'Lavozimni tanlang' })
  position: CandidatePosition;

  @ApiProperty({
    enum: CandidateStatus,
    required: false,
    description: "Bo'lmasa — `new`",
  })
  @IsOptional()
  @IsEnum(CandidateStatus, { message: "Holat noto'g'ri" })
  status?: CandidateStatus;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      "Fan — faqat o'qituvchi (majburiy) va yordamchi o'qituvchi uchun; boshqa lavozimda tozalanadi",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subjectId?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'Chilonzor, 9-kvartal',
  })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @ApiProperty({
    required: false,
    description: "Filial (faqat admin). Bo'lmasa — xodimning o'z filiali",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  centerId?: number;
}

export class UpdateCandidateDto extends PartialType(CreateCandidateDto) {}

export class QueryCandidatesDto {
  @ApiProperty({ required: false, description: 'Filial (admin tanlaydi)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  centerId?: number;

  @ApiProperty({ required: false, description: 'Ism, familiya yoki telefon' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subjectId?: number;

  @ApiProperty({ required: false, enum: CandidatePosition })
  @IsOptional()
  @IsEnum(CandidatePosition)
  position?: CandidatePosition;

  @ApiProperty({ required: false, enum: CandidateStatus })
  @IsOptional()
  @IsEnum(CandidateStatus)
  status?: CandidateStatus;

  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}

export class CandidateSubjectDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

export class CandidateResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() centerId: number;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty() phone: string;
  @ApiProperty() experience: string;
  @ApiProperty() birthYear: number;
  @ApiProperty({ nullable: true }) subjectId: number | null;
  @ApiProperty({ type: CandidateSubjectDto, nullable: true })
  subject: CandidateSubjectDto | null;
  @ApiProperty({ enum: CandidatePosition }) position: CandidatePosition;
  @ApiProperty({ enum: CandidateStatus }) status: CandidateStatus;
  @ApiProperty({
    nullable: true,
    description: "Xodimlarga o'tkazilgan bo'lsa — xodim id",
  })
  hiredUserId: number | null;
  @ApiProperty({ nullable: true }) address: string | null;
  @ApiProperty({ nullable: true }) comment: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

/** `PUT /candidates/:id/status` */
export class ChangeCandidateStatusDto {
  @ApiProperty({ enum: CandidateStatus })
  @IsEnum(CandidateStatus, { message: "Holat noto'g'ri" })
  status: CandidateStatus;
}

/**
 * `POST /candidates/:id/hire` — nomzodni xodimlarga o'tkazish. Ism/familiya/
 * telefon/filial nomzoddan olinadi (berilsa — almashtiriladi); login, parol
 * va rol nomzodda yo'q — forma so'raydi.
 */
export class HireCandidateDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Ism majburiy' })
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Familiya majburiy' })
  lastName?: string;

  @ApiProperty({ required: false, example: '+998901234567' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Telefon majburiy' })
  phone?: string;

  @ApiProperty({ example: 'vali.aliyev' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Login majburiy' })
  login: string;

  @ApiProperty({ example: 'secret123' })
  @IsString()
  @MinLength(6, { message: "Parol kamida 6 belgi bo'lishi kerak" })
  password: string;

  @ApiProperty({ example: 3, description: 'Xodim roli (`GET /roles`)' })
  @Type(() => Number)
  @IsInt({ message: 'Rolni tanlang' })
  roleId: number;

  @ApiProperty({ required: false, example: 3000000 })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  salary?: number;

  @ApiProperty({ required: false, example: 40 })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  commissionPercentage?: number;
}
