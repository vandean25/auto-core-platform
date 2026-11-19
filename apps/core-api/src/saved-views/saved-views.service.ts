import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, SavedViewVisibility, type SavedView } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { acquireGuardedPriceAdvisoryLock } from '../inventory/guarded-price-operation-locks.js';
import { legacyAccessOfRole } from '../permissions/permission-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CopySavedViewDto,
  CreateSavedViewDto,
  ImportSavedViewsDto,
  ImportSavedViewsResponseDto,
  SavedViewDto,
  SavedViewImportStatusDto,
  SavedViewsListResponseDto,
  UpdateSavedViewDto,
} from './dto/saved-views.dto.js';
import {
  SAVED_VIEW_LIST_REGISTRY,
  SAVED_VIEW_PER_LIST_LIMIT,
  getSavedViewListEntry,
  validateSavedViewHref,
  validateSavedViewInput,
  validateSavedViewName,
} from './saved-views.registry.js';

function isPrismaUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function mapSavedView(row: SavedView): SavedViewDto {
  return {
    id: row.id,
    listPath: row.list_path,
    name: row.name,
    href: row.href,
    visibility: row.visibility,
    ownerUserId: row.owner_user_id,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function canReadListPath(role: string | undefined, listPath: string): boolean {
  const entry = Object.hasOwn(SAVED_VIEW_LIST_REGISTRY, listPath)
    ? SAVED_VIEW_LIST_REGISTRY[listPath]
    : undefined;
  if (!entry) {
    return false;
  }
  return legacyAccessOfRole(role).permissions.has(entry.permission);
}

function canManageSharedViews(role: string | undefined): boolean {
  return legacyAccessOfRole(role).permissions.has('views.shared.manage');
}

async function acquireSavedViewLock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  scopeOwner: string,
  listPath: string,
): Promise<void> {
  await acquireGuardedPriceAdvisoryLock(
    tx,
    tenantId,
    scopeOwner,
    `saved_views:${listPath}`,
  );
}

async function assertWithinLimit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  visibility: SavedViewVisibility,
  ownerUserId: string,
  listPath: string,
): Promise<void> {
  const count = await tx.savedView.count({
    where:
      visibility === SavedViewVisibility.PERSONAL
        ? {
            tenant_id: tenantId,
            visibility: SavedViewVisibility.PERSONAL,
            owner_user_id: ownerUserId,
            list_path: listPath,
          }
        : {
            tenant_id: tenantId,
            visibility: SavedViewVisibility.TENANT,
            list_path: listPath,
          },
  });

  if (count >= SAVED_VIEW_PER_LIST_LIMIT) {
    throw new UnprocessableEntityException({
      code: 'SAVED_VIEW_LIMIT',
      message: `Maximum of ${SAVED_VIEW_PER_LIST_LIMIT} ${visibility.toLowerCase()} saved views per list reached.`,
    });
  }
}

@Injectable()
export class SavedViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly dashboardRealtime: DashboardRealtimeService,
  ) {}

  async list(listPath?: string): Promise<SavedViewsListResponseDto> {
    const { tenantId, userId, role } = await this.resolveCallerContext();

    if (listPath !== undefined) {
      getSavedViewListEntry(listPath);
      if (!canReadListPath(role, listPath)) {
        return { data: [] };
      }
    }

    const rows = await this.prisma.savedView.findMany({
      where: {
        tenant_id: tenantId,
        ...(listPath !== undefined ? { list_path: listPath } : {}),
        OR: [
          {
            visibility: SavedViewVisibility.PERSONAL,
            owner_user_id: userId,
          },
          {
            visibility: SavedViewVisibility.TENANT,
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return {
      data: rows
        .filter((row) => canReadListPath(role, row.list_path))
        .map(mapSavedView),
    };
  }

  async getImportStatus(): Promise<SavedViewImportStatusDto> {
    const { tenantId, userId } = await this.resolveCallerContext();
    const existing = await this.prisma.savedViewImport.findFirst({
      where: { tenant_id: tenantId, user_id: userId },
      select: { imported_at: true },
    });
    return { imported: existing !== null };
  }

  private validateImportViews(
    views: ImportSavedViewsDto['views'],
    role: string,
  ): {
    validItems: Array<{ listPath: string; name: string; href: string }>;
    skipped: number;
  } {
    const validItems: Array<{ listPath: string; name: string; href: string }> =
      [];
    let skipped = 0;

    for (const item of views) {
      const rawListPath = item.listPath ?? item.href.split('?')[0] ?? '';
      try {
        const validated = validateSavedViewInput({
          listPath: rawListPath,
          name: item.name,
          href: item.href,
        });
        if (!canReadListPath(role, validated.listPath)) {
          skipped += 1;
          continue;
        }
        validItems.push(validated);
      } catch {
        skipped += 1;
      }
    }

    return { validItems, skipped };
  }

  private async insertImportedViewsInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    validItems: Array<{ listPath: string; name: string; href: string }>,
  ): Promise<{ imported: number; skipped: number }> {
    const listPaths = [...new Set(validItems.map((v) => v.listPath))].sort();
    for (const listPath of listPaths) {
      await acquireSavedViewLock(tx, tenantId, userId, listPath);
    }

    const existingRows = await tx.savedView.findMany({
      where: {
        tenant_id: tenantId,
        owner_user_id: userId,
        visibility: SavedViewVisibility.PERSONAL,
        list_path: { in: listPaths },
      },
      select: { list_path: true, name: true },
    });

    const namesByListPath = new Map<string, Set<string>>();
    const countsByListPath = new Map<string, number>();
    for (const row of existingRows) {
      const set = namesByListPath.get(row.list_path) ?? new Set<string>();
      set.add(row.name.toLowerCase());
      namesByListPath.set(row.list_path, set);
      countsByListPath.set(
        row.list_path,
        (countsByListPath.get(row.list_path) ?? 0) + 1,
      );
    }

    const toCreate: Prisma.SavedViewCreateManyInput[] = [];
    let skipped = 0;
    for (const item of validItems) {
      const names = namesByListPath.get(item.listPath) ?? new Set<string>();
      const count = countsByListPath.get(item.listPath) ?? 0;
      const lowerName = item.name.toLowerCase();
      if (names.has(lowerName) || count >= SAVED_VIEW_PER_LIST_LIMIT) {
        skipped += 1;
        continue;
      }
      names.add(lowerName);
      namesByListPath.set(item.listPath, names);
      countsByListPath.set(item.listPath, count + 1);
      toCreate.push({
        tenant_id: tenantId,
        owner_user_id: userId,
        list_path: item.listPath,
        name: item.name,
        href: item.href,
        visibility: SavedViewVisibility.PERSONAL,
      });
    }

    if (toCreate.length > 0) {
      await tx.savedView.createMany({ data: toCreate });
    }
    return { imported: toCreate.length, skipped };
  }

  async importViews(
    dto: ImportSavedViewsDto,
  ): Promise<ImportSavedViewsResponseDto> {
    const { tenantId, userId, role } = await this.resolveCallerContext();

    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.savedViewImport.create({
          data: { tenant_id: tenantId, user_id: userId },
        });
      } catch (error) {
        if (isPrismaUniqueError(error)) {
          throw new ConflictException({
            code: 'ALREADY_IMPORTED',
            message: 'Saved views have already been imported for this user.',
          });
        }
        throw error;
      }

      const { validItems, skipped: validationSkipped } =
        this.validateImportViews(dto.views, role);
      if (validItems.length === 0) {
        return { imported: 0, skipped: validationSkipped };
      }

      const { imported, skipped: insertSkipped } =
        await this.insertImportedViewsInTx(tx, tenantId, userId, validItems);
      return { imported, skipped: validationSkipped + insertSkipped };
    });
  }

  async create(dto: CreateSavedViewDto): Promise<SavedViewDto> {
    const { tenantId, userId, role } = await this.resolveCallerContext();
    const visibility = dto.visibility ?? SavedViewVisibility.PERSONAL;
    const validated = validateSavedViewInput({
      listPath: dto.listPath,
      name: dto.name,
      href: dto.href,
    });

    if (!canReadListPath(role, validated.listPath)) {
      throw new ForbiddenException(
        `Missing read permission for list "${validated.listPath}".`,
      );
    }

    if (
      visibility === SavedViewVisibility.TENANT &&
      !canManageSharedViews(role)
    ) {
      throw new ForbiddenException(
        'Creating shared saved views requires views.shared.manage permission.',
      );
    }

    const scopeOwner =
      visibility === SavedViewVisibility.PERSONAL ? userId : 'TENANT';

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await acquireSavedViewLock(
          tx,
          tenantId,
          scopeOwner,
          validated.listPath,
        );
        await assertWithinLimit(
          tx,
          tenantId,
          visibility,
          userId,
          validated.listPath,
        );

        return tx.savedView.create({
          data: {
            tenant_id: tenantId,
            owner_user_id: userId,
            list_path: validated.listPath,
            name: validated.name,
            href: validated.href,
            visibility,
          },
        });
      });

      return mapSavedView(created);
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        throw new ConflictException({
          code: 'SAVED_VIEW_DUPLICATE',
          message: 'A saved view with this name already exists for this list.',
        });
      }
      throw error;
    }
  }

  private async findVisibleSavedViewOrThrow(
    tx: Prisma.TransactionClient,
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<SavedView> {
    const existing = await tx.savedView.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (
      !existing ||
      (existing.visibility === SavedViewVisibility.PERSONAL &&
        existing.owner_user_id !== userId)
    ) {
      throw new NotFoundException(`Saved view ${id} not found.`);
    }
    return existing;
  }

  private async resolveUpdateData(
    tx: Prisma.TransactionClient,
    existing: SavedView,
    dto: UpdateSavedViewDto,
    tenantId: string,
    userId: string,
    role: string | undefined,
  ) {
    if (!canReadListPath(role, existing.list_path)) {
      throw new ForbiddenException(
        `Missing read permission for list "${existing.list_path}".`,
      );
    }
    const nextVisibility = dto.visibility ?? existing.visibility;
    const involvesShared =
      existing.visibility === SavedViewVisibility.TENANT ||
      nextVisibility === SavedViewVisibility.TENANT;
    if (involvesShared && !canManageSharedViews(role)) {
      throw new ForbiddenException(
        'Managing shared saved views requires views.shared.manage permission.',
      );
    }
    if (
      existing.visibility === SavedViewVisibility.TENANT &&
      existing.owner_user_id === null &&
      nextVisibility === SavedViewVisibility.PERSONAL
    ) {
      throw new ForbiddenException(
        'Orphaned shared views cannot be unshared; copy to personal views instead.',
      );
    }
    const name =
      dto.name !== undefined ? validateSavedViewName(dto.name) : existing.name;
    const href =
      dto.href !== undefined
        ? validateSavedViewHref(dto.href, existing.list_path)
        : existing.href;
    const owner_user_id =
      nextVisibility === SavedViewVisibility.PERSONAL
        ? (existing.owner_user_id ?? userId)
        : existing.owner_user_id;
    if (nextVisibility !== existing.visibility) {
      const destinationOwner = existing.owner_user_id ?? userId;
      const scopeOwner =
        nextVisibility === SavedViewVisibility.PERSONAL
          ? destinationOwner
          : 'TENANT';
      await acquireSavedViewLock(tx, tenantId, scopeOwner, existing.list_path);
      await assertWithinLimit(
        tx,
        tenantId,
        nextVisibility,
        destinationOwner,
        existing.list_path,
      );
    }
    return { name, href, visibility: nextVisibility, owner_user_id };
  }

  async update(id: string, dto: UpdateSavedViewDto): Promise<SavedViewDto> {
    const { tenantId, userId, role } = await this.resolveCallerContext();

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await this.findVisibleSavedViewOrThrow(
          tx,
          id,
          tenantId,
          userId,
        );
        const data = await this.resolveUpdateData(
          tx,
          existing,
          dto,
          tenantId,
          userId,
          role,
        );
        const result = await tx.savedView.updateMany({
          where: { id, tenant_id: tenantId, version: dto.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (result.count === 0) {
          throw new ConflictException({
            code: 'SAVED_VIEW_CHANGED',
            message: 'The saved view has changed. Reload and try again.',
          });
        }
        const refreshed = await tx.savedView.findFirst({
          where: { id, tenant_id: tenantId },
        });
        if (!refreshed) {
          throw new NotFoundException(`Saved view ${id} not found.`);
        }
        return refreshed;
      });

      this.dashboardRealtime.emitEntityUpdated(tenantId, {
        type: 'SAVED_VIEW',
        action: 'UPDATED',
        entityId: updated.id,
        listPath: updated.list_path,
      });

      return mapSavedView(updated);
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        throw new ConflictException({
          code: 'SAVED_VIEW_DUPLICATE',
          message: 'A saved view with this name already exists for this list.',
        });
      }
      throw error;
    }
  }

  async remove(id: string, version: number): Promise<void> {
    const { tenantId, userId, role } = await this.resolveCallerContext();

    const deleted = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findVisibleSavedViewOrThrow(
        tx,
        id,
        tenantId,
        userId,
      );

      if (
        existing.visibility === SavedViewVisibility.TENANT &&
        !canManageSharedViews(role)
      ) {
        throw new ForbiddenException(
          'Deleting shared saved views requires views.shared.manage permission.',
        );
      }

      const result = await tx.savedView.deleteMany({
        where: {
          id,
          tenant_id: tenantId,
          version,
        },
      });

      if (result.count === 0) {
        throw new ConflictException({
          code: 'SAVED_VIEW_CHANGED',
          message: 'The saved view has changed. Reload and try again.',
        });
      }

      return existing;
    });

    this.dashboardRealtime.emitEntityUpdated(tenantId, {
      type: 'SAVED_VIEW',
      action: 'DELETED',
      entityId: deleted.id,
      listPath: deleted.list_path,
    });
  }

  async copy(id: string, dto: CopySavedViewDto): Promise<SavedViewDto> {
    const { tenantId, userId, role } = await this.resolveCallerContext();

    const source = await this.prisma.savedView.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (
      !source ||
      (source.visibility === SavedViewVisibility.PERSONAL &&
        source.owner_user_id !== userId)
    ) {
      throw new NotFoundException(`Saved view ${id} not found.`);
    }

    if (!canReadListPath(role, source.list_path)) {
      throw new ForbiddenException(
        `Missing read permission for list "${source.list_path}".`,
      );
    }

    const name = validateSavedViewName(dto.name ?? source.name);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await acquireSavedViewLock(tx, tenantId, userId, source.list_path);
        await assertWithinLimit(
          tx,
          tenantId,
          SavedViewVisibility.PERSONAL,
          userId,
          source.list_path,
        );

        return tx.savedView.create({
          data: {
            tenant_id: tenantId,
            owner_user_id: userId,
            list_path: source.list_path,
            name,
            href: source.href,
            visibility: SavedViewVisibility.PERSONAL,
          },
        });
      });

      return mapSavedView(created);
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        throw new ConflictException({
          code: 'SAVED_VIEW_DUPLICATE',
          message: 'A saved view with this name already exists for this list.',
        });
      }
      throw error;
    }
  }

  private async resolveCallerContext(): Promise<{
    tenantId: string;
    userId: string;
    role: string;
  }> {
    const tenantId = this.tenantContext.getRequiredTenantId();
    const authUser = this.tenantContext.getAuthenticatedUser();
    if (!authUser?.userId) {
      throw new ForbiddenException('Active tenant session is required.');
    }

    const userRow = await this.prisma.user.findFirst({
      where: { firebaseUid: authUser.userId },
      select: { id: true },
    });
    if (!userRow) {
      throw new ForbiddenException('Active user record not found.');
    }

    return {
      tenantId,
      userId: userRow.id,
      role: authUser.role ?? '',
    };
  }
}
