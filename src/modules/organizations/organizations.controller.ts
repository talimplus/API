import { Controller, Get, Param } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.organizationsService.findById(id);
  }
}
