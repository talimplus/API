import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class SetBotTokenDto {
  @ApiProperty({
    description:
      '@BotFather bergan token. Username qo‘lda kiritilmaydi — token saqlanayotganda getMe() dan olinadi.',
    example: '1234567890:AAF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  @MaxLength(128)
  // <bot_id>:<secret> — noto'g'ri yopishtirilgan matnni Telegram'ga bormasdan
  // to'sadi (masalan username yoki bo'sh joy bilan kelgan qiymat).
  @Matches(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, {
    message:
      "Token formati noto'g'ri. @BotFather bergan `123456789:AA...` ko'rinishidagi qiymatni kiriting.",
  })
  botToken: string;
}
