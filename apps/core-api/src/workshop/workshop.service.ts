import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import type { RegisterIntakeDto } from './dto/register-intake.dto';
import { WorkshopOrderStatus } from '@prisma/client';

@Injectable()
export class WorkshopService {
  constructor(private prisma: PrismaService) {}

  async register(dto: RegisterIntakeDto) {
    let customerId = dto.customerId;

    if (!customerId) {
      // Check for existing customer by email to avoid unique constraint violation
      const existingCustomer = dto.email ? await this.prisma.customer.findUnique({ where: { email: dto.email } }) : null;

      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const customer = await this.prisma.customer.create({
          data: {
            first_name: dto.firstName || '',
            last_name: dto.lastName || '',
            email: dto.email,
            phone: dto.phone,
            type: 'PRIVATE',
          },
        });
        customerId = customer.id;
      }
    } else {
      const exists = await this.prisma.customer.findUnique({ where: { id: customerId } });
      if (!exists) throw new NotFoundException(`Customer ${customerId} not found`);
    }

    // Use upsert for vehicle to handle existing VINs (returning customers/vehicles)
    const vehicle = await this.prisma.vehicle.upsert({
      where: { vin: dto.vin },
      update: {
        plate: dto.plate,
        customer_id: customerId,
        // We could update make/model/year too, but VIN usually implies same vehicle.
        // Plate might change. Customer might change (sold car).
      },
      create: {
        vin: dto.vin,
        plate: dto.plate,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        customer_id: customerId,
      },
      include: {
        customer: true,
      }
    });

    return vehicle;
  }

  async create(dto: CreateWorkshopOrderDto) {
    const [customer, vehicle] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: dto.customerId } }),
      this.prisma.vehicle.findUnique({ where: { id: dto.vehicleId } }),
    ]);
    if (!customer) throw new NotFoundException(`Customer ${dto.customerId} not found`);
    if (!vehicle) throw new NotFoundException(`Vehicle ${dto.vehicleId} not found`);

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
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);

    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        OR: [
          { vin: { contains: query, mode: 'insensitive' } },
          { plate: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        customer: true,
      },
    });

    const customers = await this.prisma.customer.findMany({
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
    });

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
}
