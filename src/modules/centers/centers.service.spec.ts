import { Test, TestingModule } from '@nestjs/testing';
import { CentersService } from './centers.service';

describe('CentersService', () => {
  let service: CentersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CentersService],
    }).compile();

    service = module.get<CentersService>(CentersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
