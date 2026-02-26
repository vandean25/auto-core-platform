import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import type { RegisterIntakeDto } from './dto/register-intake.dto';
import { Prisma, WorkshopOrderStatus } from '@prisma/client';
import { QueryBuilder, QueryParams } from '../common/utils/query-builder';

@Injectable()
export class WorkshopService {
  constructor(private prisma: PrismaService) { }

  async register(dto: RegisterIntakeDto) {
    return this.prisma.$transaction(async (tx) => {
      let customerId = dto.customerId;

      if (!customerId) {
        if (dto.email) {
          try {
            const customer = await tx.customer.create({
              data: {
                first_name: dto.firstName || '',
                last_name: dto.lastName || '',
                email: dto.email,
                phone: dto.phone,
                type: 'PRIVATE',
              },
            });
            customerId = customer.id;
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            ) {
              const existingCustomer = await tx.customer.findUnique({
                where: { email: dto.email },
              });
              if (existingCustomer) {
                customerId = existingCustomer.id;
              } else {
                throw error;
              }
            } else {
              throw error;
            }
          }
        } else {
          const customer = await tx.customer.create({
            data: {
              first_name: dto.firstName || '',
              last_name: dto.lastName || '',
              // email is undefined
              phone: dto.phone,
              type: 'PRIVATE',
            },
          });
          customerId = customer.id;
        }
      } else {
        const exists = await tx.customer.findUnique({
          where: { id: customerId },
        });
        if (!exists)
          throw new NotFoundException(`Customer ${customerId} not found`);
      }

      const existingVehicle = await tx.vehicle.findUnique({
        where: { vin: dto.vin },
      });

      if (existingVehicle && existingVehicle.customer_id !== customerId) {
        throw new BadRequestException(
          'Vehicle is registered to a different customer. Please use the ownership transfer flow.',
        );
      }

      // Use upsert for vehicle to handle existing VINs (returning customers/vehicles)
      const vehicle = await tx.vehicle.upsert({
        where: { vin: dto.vin },
        update: {
          plate: dto.plate,
        },
        create: {
          vin: dto.vin,
          plate: dto.plate,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          customer_id: customerId!,
        },
        include: {
          customer: true,
        },
      });

      return vehicle;
    });
  }

  async create(dto: CreateWorkshopOrderDto) {
    const [customer, vehicle] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: dto.customerId } }),
      this.prisma.vehicle.findUnique({ where: { id: dto.vehicleId } }),
    ]);
    if (!customer)
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    if (!vehicle)
      throw new NotFoundException(`Vehicle ${dto.vehicleId} not found`);

    return this.prisma.workshopOrder.create({
      data: {
        customer_id: dto.customerId,
        vehicle_id: dto.vehicleId,
        odometer: dto.odometer,
        fuel_level: dto.fuelLevel,
        notes: dto.notes,
        status: WorkshopOrderStatus.INTAKE,
      },
      include: {
        customer: true,
        vehicle: true,
      },
    });
  }

  async search(query: string) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        query,
      );

    const [vehicles, customers] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: {
          OR: [
            { vin: { contains: query, mode: 'insensitive' } },
            { plate: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          customer: true,
        },
      }),
      this.prisma.customer.findMany({
        where: {
          OR: [
            ...(isUuid ? [{ id: { equals: query } }] : []),
            { first_name: { contains: query, mode: 'insensitive' } },
            { last_name: { contains: query, mode: 'insensitive' } },
            { company_name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          vehicles: true,
        },
      }),
    ]);

    return {
      data: { vehicles, customers },
      meta: {
        total: vehicles.length + customers.length,
        page: 1,
        limit: 100, // Hardcoded for now as per current logic
        totalPages: 1,
      },
    };
  }

  async findAll(params: QueryParams) {
    const whitelist = [
      'status',
      'vehicle.make',
      'vehicle.model',
      'vehicle.plate',
      'vehicle.vin',
      'customer.first_name',
      'customer.last_name',
      'customer.email',
      'createdAt',
    ];

    const searchFields = [
      'vehicle.make',
      'vehicle.model',
      'vehicle.plate',
      'vehicle.vin',
      'customer.first_name',
      'customer.last_name',
    ];

    const query = QueryBuilder.buildPrismaQuery(
      params,
      whitelist,
      searchFields,
    );

    const [orders, total] = await Promise.all([
      this.prisma.workshopOrder.findMany({
        ...(query as Prisma.WorkshopOrderFindManyArgs),
        include: {
          customer: true,
          vehicle: true,
        },
      }),
      this.prisma.workshopOrder.count({
        where: query.where as Prisma.WorkshopOrderWhereInput,
      }),
    ]);

    const pageSize = params.pageSize || 25;
    const totalPages = Math.ceil(total / pageSize);

    return {
      data: orders,
      meta: {
        total,
        page: params.page || 1,
        limit: pageSize,
        totalPages,
      },
    };
  }
}
