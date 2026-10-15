import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { DocumentBrandingModule } from '../document-branding/document-branding.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module.js';
import { PartsRequisitionModule } from '../parts-requisition/parts-requisition.module.js';
import { OPENHOLIDAYS_FETCH } from './openholidays.client.js';
import { PublicEstimateApprovalController } from './public-estimate-approval/public-estimate-approval.controller.js';
import { PublicEstimateApprovalLookup } from './public-estimate-approval/public-estimate-approval.lookup.js';
import { PublicEstimateApprovalRateLimiter } from './public-estimate-approval/public-estimate-approval.rate-limit.js';
import { PublicEstimateApprovalService } from './public-estimate-approval/public-estimate-approval.service.js';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer.js';
import { WorkshopBoardService } from './workshop-board.service.js';
import { WorkshopHolidayService } from './workshop-holiday.service.js';
import { WorkshopIntakeService } from './workshop-intake.service.js';
import { WorkshopInvoiceService } from './workshop-invoice.service.js';
import { WorkshopEstimateController } from './workshop-estimate.controller.js';
import { WorkshopEstimatePdfRenderer } from './workshop-estimate-pdf.renderer.js';
import { WorkshopEstimatePdfService } from './workshop-estimate-pdf.service.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';
import { WorkshopEstimateApprovalService } from './workshop-estimate-approval.service.js';
import { WorkshopEstimateOverrunService } from './workshop-estimate-overrun.service.js';
import { WorkshopOverrunNoticeService } from './workshop-overrun-notice.service.js';
import { WorkshopWaitingTasksService } from './workshop-waiting-tasks.service.js';
import { WorkshopWaitingTasksController } from './workshop-waiting-tasks.controller.js';
import { AuditModule } from '../audit/audit.module.js';
import { WorkshopPdfService } from './workshop-pdf.service.js';
import { WorkshopPickPartsService } from './workshop-pick-parts.service.js';
import { WorkshopPlannerService } from './workshop-planner.service.js';
import { WorkshopScheduleService } from './workshop-schedule.service.js';
import { WorkshopSettingsService } from './workshop-settings.service.js';
import { WorkshopTaskService } from './workshop-task.service.js';
import { WorkshopCatalogLineService } from './workshop-catalog-line.service.js';
import { WorkshopController } from './workshop.controller.js';
import { WorkshopHolidayController } from './workshop-holidays.controller.js';
import { WorkshopSettingsController } from './workshop-settings.controller.js';
import { WorkshopPlannerController } from './workshop-planner.controller.js';
import { WorkshopCapacityController } from './workshop-capacity.controller.js';
import { WorkshopCapacityService } from './workshop-capacity.service.js';
import { WorkshopInspectionService } from './workshop-inspection.service.js';
import { WorkshopKpiReportsController } from './workshop-kpi-reports.controller.js';
import { WorkshopKpiReportsService } from './workshop-kpi-reports.service.js';
import { RegistrationIntakeModule } from '../registration-intake/registration-intake.module.js';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    DocumentBrandingModule,
    InvoicesModule,
    InventoryModule,
    CommonModule,
    VehicleStockModule,
    PartsRequisitionModule,
    AuditModule,
    forwardRef(() => RegistrationIntakeModule),
  ],
  controllers: [
    PublicEstimateApprovalController,
    WorkshopHolidayController,
    WorkshopSettingsController,
    WorkshopPlannerController,
    WorkshopCapacityController,
    WorkshopController,
    WorkshopKpiReportsController,
    WorkshopEstimateController,
    WorkshopWaitingTasksController,
  ],
  providers: [
    PublicEstimateApprovalService,
    PublicEstimateApprovalLookup,
    PublicEstimateApprovalRateLimiter,
    WorkshopEstimateService,
    WorkshopEstimateApprovalService,
    WorkshopEstimateOverrunService,
    WorkshopOverrunNoticeService,
    WorkshopWaitingTasksService,
    WorkshopEstimatePdfService,
    WorkshopEstimatePdfRenderer,
    WorkshopIntakeService,
    WorkshopTaskService,
    WorkshopInspectionService,
    WorkshopCatalogLineService,
    WorkshopPickPartsService,
    WorkshopBoardService,
    WorkshopInvoiceService,
    WorkshopPdfService,
    WorkshopPdfRenderer,
    WorkshopSettingsService,
    WorkshopHolidayService,
    WorkshopPlannerService,
    WorkshopCapacityService,
    WorkshopScheduleService,
    WorkshopKpiReportsService,
    { provide: OPENHOLIDAYS_FETCH, useValue: fetch },
  ],
  exports: [
    WorkshopSettingsService,
    WorkshopIntakeService,
    WorkshopTaskService,
    WorkshopBoardService,
    WorkshopKpiReportsService,
    WorkshopPlannerService,
  ],
})
export class WorkshopModule {}
