import { Injectable } from '@nestjs/common';
import { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import { WorkshopMechanicFindingService } from '../workshop/workshop-mechanic-finding.service.js';
import { loadMcpWorkshopOrderWithMechanicFindings } from './mcp-workshop-order-mechanic-findings.read.js';

@Injectable()
export class McpWorkshopOrderDetailReadService {
  constructor(
    private readonly workshopIntake: WorkshopIntakeService,
    private readonly mechanicFindings: WorkshopMechanicFindingService,
  ) {}

  getWorkshopOrder(input: { workshop_order_id: string }) {
    return loadMcpWorkshopOrderWithMechanicFindings(
      input.workshop_order_id,
      this.workshopIntake,
      this.mechanicFindings,
    );
  }
}
