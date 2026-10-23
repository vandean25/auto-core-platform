import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VehicleRecordSource } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import type {
  CreateVehiclePartyDto,
  EndVehiclePartyDto,
} from './dto/vehicle-party.dto.js';
import {
  toPartiesResponse,
  toPartyResponse,
  type PartyRowWithCustomer,
} from './vehicle-party-response.mapper.js';
import { PARTY_CUSTOMER_SUMMARY } from './vehicle-persistence.service.js';
import {
  VEHICLE_PARTY_ERROR_CODES,
  suggestBillTo,
} from './vehicle-party.rules.js';
import {
  addPartyInTx,
  endPartyInTx,
  toPartyInterval,
  type PartyWriteContext,
} from './vehicle-party.writer.js';

const PARTY_WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'SALES']);

@Injectable()
export class VehiclePartyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(vehicleId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertVehicleExists(tenantId, vehicleId);
    const rows = await this.loadRows(tenantId, vehicleId);
    const today = viennaIsoDay(new Date());
    return toPartiesResponse(
      rows,
      suggestBillTo(rows.map(toPartyInterval), today),
      today,
    );
  }

  async add(vehicleId: string, dto: CreateVehiclePartyDto) {
    this.assertWriteAccess();
    const ctx = await this.writeContext();
    const created = await this.prisma.$transaction((tx) =>
      addPartyInTx(tx, ctx, vehicleId, {
        customer_id: dto.customer_id,
        role: dto.role,
        valid_from: dto.valid_from ?? null,
        valid_to: dto.valid_to ?? null,
        notes: dto.notes ?? null,
        source: VehicleRecordSource.MANUAL,
      }),
    );
    return this.findOneResponse(ctx, vehicleId, created.id);
  }

  async end(vehicleId: string, partyId: string, dto: EndVehiclePartyDto) {
    this.assertWriteAccess();
    const ctx = await this.writeContext();
    await this.prisma.$transaction((tx) =>
      endPartyInTx(tx, ctx, vehicleId, partyId, dto.valid_to ?? ctx.today),
    );
    return this.findOneResponse(ctx, vehicleId, partyId);
  }

  private assertWriteAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.role || !PARTY_WRITE_ROLES.has(user.role)) {
      throw new ForbiddenException({
        code: VEHICLE_PARTY_ERROR_CODES.WRITE_FORBIDDEN,
        message: 'Only OWNER, ADMIN, or SALES may modify vehicle parties.',
      });
    }
  }

  private async writeContext(): Promise<PartyWriteContext> {
    return {
      tenantId: await this.tenantContext.getTenantId(),
      today: viennaIsoDay(new Date()),
    };
  }

  private async assertVehicleExists(tenantId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }
  }

  private loadRows(
    tenantId: string,
    vehicleId: string,
  ): Promise<PartyRowWithCustomer[]> {
    return this.prisma.vehicleParty.findMany({
      where: { tenant_id: tenantId, vehicle_id: vehicleId },
      include: { customer: PARTY_CUSTOMER_SUMMARY },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  private async findOneResponse(
    ctx: PartyWriteContext,
    vehicleId: string,
    partyId: string,
  ) {
    const row = await this.prisma.vehicleParty.findFirst({
      where: { id: partyId, tenant_id: ctx.tenantId, vehicle_id: vehicleId },
      include: { customer: PARTY_CUSTOMER_SUMMARY },
    });
    if (!row) {
      throw new NotFoundException(`Vehicle party ${partyId} not found`);
    }
    return toPartyResponse(row, ctx.today);
  }
}
