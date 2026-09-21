import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrganizationBrandingDto {
  @ApiProperty() organizationId: number;

  @ApiProperty({ description: "O'quv markazi nomi" })
  name: string;

  @ApiPropertyOptional({
    description: 'Logotip — data URL yoki https havolasi',
  })
  logoUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Favicon — data URL yoki https havolasi',
  })
  faviconUrl?: string | null;

  @ApiPropertyOptional() brandingUpdatedAt?: Date | null;
}
