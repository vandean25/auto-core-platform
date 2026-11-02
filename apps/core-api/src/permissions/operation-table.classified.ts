import {
  BACK_OFFICE,
  BACK_OFFICE_DEMO,
  EVERY_ROLE,
  apiKey,
  classified,
} from './operation-helpers.js';
import type { OperationTable } from './operation-types.js';

export const CLASSIFIED_OPERATIONS: OperationTable = {
  'AppController.getHello': classified(
    'session',
    'Authenticated greeting. No tenant data, no tenant role required.',
    BACK_OFFICE_DEMO,
  ),
  'AppController.getSentryError': classified(
    'session',
    'Debug route. Answers 404 unless ENABLE_SENTRY_DEBUG_ROUTE is set.',
    BACK_OFFICE_DEMO,
  ),
  'HealthController.getHealth': classified(
    'public',
    'Unauthenticated liveness probe.',
  ),
  'AuthController.getMe': classified(
    'session',
    'Own session. Resolves the memberships and active tenant. Mechanic-accessible.',
    EVERY_ROLE,
  ),
  'AuthController.switchTenant': classified(
    'session',
    'Authorized context selection among the own memberships.',
    BACK_OFFICE_DEMO,
  ),
  'AuthLocalePreferencesController.getPreferences': classified(
    'session',
    'Own locale preferences. Interactive user only, also for platform admins.',
    EVERY_ROLE,
  ),
  'AuthLocalePreferencesController.patchPreferences': classified(
    'session',
    'Own locale preferences. Interactive user only, also for platform admins.',
    EVERY_ROLE,
  ),
  'MeSiteController.listMySites': classified(
    'session',
    'Own site memberships. Mechanic-accessible.',
    EVERY_ROLE,
  ),
  'MeSiteController.setActiveSite': classified(
    'session',
    'Authorized context selection among the own site memberships.',
    EVERY_ROLE,
  ),
  'PushController.listDevices': classified(
    'session',
    'Own push devices of the signed-in user.',
    BACK_OFFICE_DEMO,
  ),
  'PushController.registerDevice': classified(
    'session',
    'Own push devices of the signed-in user.',
    BACK_OFFICE,
  ),
  'PushController.revokeDevice': classified(
    'session',
    'Own push devices of the signed-in user.',
    BACK_OFFICE,
  ),
  'PushController.getPreferences': classified(
    'session',
    'Own push preferences of the signed-in user.',
    BACK_OFFICE_DEMO,
  ),
  'PushController.updatePreferences': classified(
    'session',
    'Own push preferences of the signed-in user.',
    BACK_OFFICE,
  ),
  'PushController.sendTest': classified(
    'session',
    'Test push to the own devices.',
    BACK_OFFICE,
  ),
  'PlatformAdminController.findAll': classified(
    'platform_admin',
    'Platform super-admin only. Tenant provisioning, outside tenant roles.',
  ),
  'PlatformAdminController.create': classified(
    'platform_admin',
    'Platform super-admin only. Tenant provisioning, outside tenant roles.',
  ),
  'PlatformAdminController.update': classified(
    'platform_admin',
    'Platform super-admin only. Tenant provisioning, outside tenant roles.',
  ),
  'AdminLogLevelController.getLogLevel': classified(
    'platform_admin',
    'Platform super-admin only. Runtime log level.',
  ),
  'AdminLogLevelController.updateLogLevel': classified(
    'platform_admin',
    'Platform super-admin only. Runtime log level.',
  ),
  'LandingDemoAccessController.submit': classified(
    'public',
    'Landing-page demo sign-up. Honeypot, throttle and email-hash limits.',
  ),
  'PublicEstimateApprovalController.read': classified(
    'public',
    'Customer estimate approval by signed token. Throttled.',
  ),
  'PublicEstimateApprovalController.decide': classified(
    'public',
    'Customer estimate approval by signed token. Throttled.',
  ),
  'PublicCustomerConsentUnsubscribeController.unsubscribe': classified(
    'public',
    'Customer unsubscribe by signed token. Throttled.',
  ),
  'McpController.handleMcp': classified(
    'mcp_gateway',
    'Guard-exempt transport. Authenticates the bearer session itself and admits OWNER, ADMIN and SALES. Tools are mapped in the MCP table.',
  ),
  'InvoicesController.generatePdfWorker': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and task-tenant guards.',
  ),
  'CreditNotesController.generatePdfWorker': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and task-tenant guards.',
  ),
  'WorkshopOrderPdfController.generatePdfWorker': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and task-tenant guards.',
  ),
  'WorkshopEstimateController.generatePdfWorker': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and task-tenant guards.',
  ),
  'VehicleSaleController.generateKaufvertragPdfWorker': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and task-tenant guards.',
  ),
  'DocumentBrandingUploadWorkerController.validate': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and upload-task guards.',
  ),
  'DocumentBrandingExtractionWorkerController.extract': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and extraction-task guards.',
  ),
  'WorkshopEstimateDecidedConsumerWorkerController.run': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and consumer-task guards.',
  ),
  'NotificationOutboxWorkerController.deliver': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and notification-task guards.',
  ),
  'ImportWorkerController.runWorker': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and import-task guards.',
  ),
  'ImportPurgeWorkerController.runWorker': classified(
    'service_job',
    'Cloud Tasks worker. Cloud Tasks identity and import-purge guards.',
  ),
  'InternalCronController.invoke': classified(
    'service_job',
    'Scheduler call. Cron OIDC identity and HTTP cron mode guards.',
  ),
  'PublicCustomersController.list': apiKey(
    'customers:read',
    'customer.read',
    'Public API v1. Tenant API key with the customers:read scope.',
  ),
  'PublicCustomersController.findOne': apiKey(
    'customers:read',
    'customer.read',
    'Public API v1. Tenant API key with the customers:read scope.',
  ),
  'PublicVehiclesController.list': apiKey(
    'vehicles:read',
    'vehicle.read',
    'Public API v1. Tenant API key with the vehicles:read scope.',
  ),
  'PublicVehiclesController.findOne': apiKey(
    'vehicles:read',
    'vehicle.read',
    'Public API v1. Tenant API key with the vehicles:read scope.',
  ),
  'PublicInvoicesController.list': apiKey(
    'invoices:read',
    'invoice.read',
    'Public API v1. Tenant API key with the invoices:read scope.',
  ),
  'PublicInvoicesController.findOne': apiKey(
    'invoices:read',
    'invoice.read',
    'Public API v1. Tenant API key with the invoices:read scope.',
  ),
  'PublicWorkshopOrdersController.list': apiKey(
    'workshop-orders:read',
    'workshop.order.read',
    'Public API v1. Tenant API key with the workshop-orders:read scope.',
  ),
  'PublicWorkshopOrdersController.findOne': apiKey(
    'workshop-orders:read',
    'workshop.order.read',
    'Public API v1. Tenant API key with the workshop-orders:read scope.',
  ),
  'PublicStockController.list': apiKey(
    'stock:read',
    'stock.read',
    'Public API v1. Tenant API key with the stock:read scope.',
  ),
};
