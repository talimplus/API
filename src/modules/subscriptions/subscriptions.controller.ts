import { Controller, Get, Param } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('organization/:id')
  findByOrg(@Param('id') id: number) {
    return this.subscriptionsService.findByOrganization(id);
  }
}
