import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CustomFieldEntity } from '@prisma/client';
import type { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import type { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import { CustomFieldsService } from '../custom-fields/custom-fields.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import type {
  PickerlDueListExportQueryDto,
  PickerlDueListQueryDto,
} from './dto/pickerl-due-list.dto.js';
import { buildPickerlDueCsv } from './vehicle-pickerl-csv.util.js';
import { stripVehicleIdentityResolutionState } from './vehicle-identity.util.js';
import { VehicleQueryBuilder } from './vehicle-query.builder.js';
import { VehiclePersistenceService } from './vehicle-persistence.service.js';
import { VehiclePickerlDueService } from './vehicle-pickerl-due.service.js';
import { VehiclePickerlBarrierService } from './vehicle-pickerl-barrier.service.js';
import { rethrowVehiclePrismaError } from './vehicle-prisma-error.util.js';
import {
  toVehicleDetailResponse,
  toVehicleListResponse,
} from './vehicle-response.mapper.js';
import { VehicleWriteService } from './vehicle-write.service.js';
import { clearRegistrationEvidenceForVehicle } from '../registration-intake/registration-intake-evidence-cleanup.js';

export { clearRegistrationEvidenceForVehicle };

/**
 * Facade over the vehicle collaborators: tenant/site context is resolved here,
 * persistence lives in VehiclePersistenceService, create/update validation in
 * VehicleWriteService, and the Pickerl due pipeline in VehiclePickerlDueService.
 */
@Injectable()
export class VehicleService {
  constructor(
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly persistence: VehiclePersistenceService,
    private readonly writes: VehicleWriteService,
    private readonly pickerlDue: VehiclePickerlDueService,
    private readonly pickerlBarriers: VehiclePickerlBarrierService,
    @Optional() private readonly customFields?: CustomFieldsService,
  ) {}

  private async maskVehicleCustomFields<T extends { custom_fields?: unknown }>(
    vehicle: T,
  ): Promise<T> {
    if (!this.customFields) {
      const { custom_fields: _omitted, ...rest } = vehicle;
      return rest as T;
    }
    const visible = await this.customFields.projectVisibleCustomFields(
      CustomFieldEntity.VEHICLE,
      vehicle.custom_fields,
    );
    if (visible === undefined) {
      const { custom_fields: _omitted, ...rest } = vehicle;
      return rest as T;
    }
    return { ...vehicle, custom_fields: visible };
  }

  async getPickerlDueData(
    query: PickerlDueListQueryDto | PickerlDueListExportQueryDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();

    return this.pickerlDue.listDue(
      query,
      { tenantId, authorizedSiteIds },
      new Date(),
    );
  }

  async findPickerlDue(query: PickerlDueListQueryDto) {
    const allData = await this.getPickerlDueData(query);
    const [tenantId, activeSiteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.resolveSiteId(),
    ]);

    return this.pickerlDue.findDuePage(allData, query, {
      tenantId,
      activeSiteId,
    });
  }

  async findOpenPickerlWorkshopOrder(vehicleId: string) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    return this.persistence.findOpenPickerlOrder(vehicleId, tenantId, siteId);
  }

  async exportPickerlDueCsv(query: PickerlDueListExportQueryDto) {
    const allData = await this.getPickerlDueData(query);

    return buildPickerlDueCsv(allData);
  }

  async create(createVehicleDto: CreateVehicleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const validatedCustomFields =
      createVehicleDto.custom_fields !== undefined && this.customFields
        ? await this.customFields.prepareEntityCustomFieldsWrite(
            CustomFieldEntity.VEHICLE,
            {},
            createVehicleDto.custom_fields,
          )
        : undefined;
    const data = await this.writes.prepareCreate(
      {
        ...createVehicleDto,
        ...(validatedCustomFields !== undefined
          ? { custom_fields: validatedCustomFields }
          : {}),
      },
      tenantId,
    );

    try {
      const createdVehicle = await this.persistence.createVehicle(data);

      return this.maskVehicleCustomFields(
        stripVehicleIdentityResolutionState(createdVehicle),
      );
    } catch (error: unknown) {
      rethrowVehiclePrismaError(error);
    }
  }

  async findAll(params: {
    search?: string;
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds: string[] =
      await this.siteContext.listAuthorizedSiteIds();
    const { page, pageSize, skip, take } =
      VehicleQueryBuilder.resolvePagination(params.page, params.pageSize);
    const sortDirection =
      params.sortDirection ?? VehicleQueryBuilder.DEFAULT_SORT_DIRECTION;

    const { rows, total } = await this.persistence.listVehicles({
      tenantId,
      search: params.search,
      where: VehicleQueryBuilder.buildWhere(tenantId, params.search),
      orderBy: VehicleQueryBuilder.computeOrderBy(
        params.sortField,
        sortDirection,
      ),
      skip,
      take,
    });

    const response = toVehicleListResponse({
      rows,
      total,
      page,
      pageSize,
      authorizedSiteIds,
    });
    return {
      ...response,
      data: await Promise.all(
        (response.data ?? []).map((row) => this.maskVehicleCustomFields(row)),
      ),
    };
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds: string[] =
      await this.siteContext.listAuthorizedSiteIds();
    const vehicle = await this.persistence.findVehicleDetail(
      id,
      tenantId,
      authorizedSiteIds,
    );

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }

    const barriers = await this.pickerlBarriers.loadBarrierFlags(tenantId, id);
    return this.maskVehicleCustomFields(
      toVehicleDetailResponse(
        vehicle,
        authorizedSiteIds,
        new Date(),
        barriers,
      ),
    );
  }

  async update(id: string, updateVehicleDto: UpdateVehicleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const existingVehicle = await this.writes.loadExistingIdentity(
      id,
      tenantId,
    );
    const validatedCustomFields =
      updateVehicleDto.custom_fields !== undefined && this.customFields
        ? await this.customFields.prepareEntityCustomFieldsWrite(
            CustomFieldEntity.VEHICLE,
            await this.persistence.findVehicleCustomFields(id, tenantId),
            updateVehicleDto.custom_fields,
          )
        : undefined;
    const data = await this.writes.prepareUpdate(
      existingVehicle,
      {
        ...updateVehicleDto,
        ...(validatedCustomFields !== undefined
          ? { custom_fields: validatedCustomFields }
          : {}),
      },
      tenantId,
    );

    try {
      const updatedVehicle = await this.writes.applyUpdate(
        id,
        tenantId,
        existingVehicle,
        data,
      );

      return this.maskVehicleCustomFields(
        stripVehicleIdentityResolutionState(updatedVehicle),
      );
    } catch (error: unknown) {
      rethrowVehiclePrismaError(error);
    }
  }
}
