import 'dotenv/config';
import {
    PrismaClient,
    LocationType,
    TransactionType,
    CustomerType,
    SalesOrderStatus,
    InvoiceStatus,
    WorkshopOrderStatus,
    PurchaseOrderStatus,
    PurchaseInvoiceStatus
} from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function cleanDb() {
    console.log('Cleaning database...');
    // Delete in order to satisfy foreign key constraints
    await prisma.workshopOrder.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.invoiceSequence.deleteMany();
    await prisma.salesOrderItem.deleteMany();
    await prisma.salesOrder.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.customer.deleteMany();
    
    await prisma.purchaseInvoiceLine.deleteMany();
    await prisma.purchaseInvoice.deleteMany();
    await prisma.purchaseOrderItem.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.vendor.deleteMany();
    
    await prisma.inventoryTransaction.deleteMany();
    await prisma.inventoryStock.deleteMany();
    await prisma.catalogItem.deleteMany();
    await prisma.storageLocation.deleteMany();
    await prisma.revenueGroup.deleteMany();
    await prisma.financeSettings.deleteMany();
    await prisma.brand.deleteMany();
}

/**
 * Helper function to record an inventory transaction (ledger-based approach)
 */
async function recordInitialStock(
    itemId: string,
    locationId: string,
    quantity: number,
    costBasis: number,
    reserved: number = 0
) {
    // Create the transaction record
    await prisma.inventoryTransaction.create({
        data: {
            item_id: itemId,
            location_id: locationId,
            quantity: quantity,
            type: TransactionType.INITIAL_BALANCE,
            reference_id: 'SEED_SCRIPT',
            cost_basis: costBasis,
        },
    });

    // Update or create the cached stock (using findFirst + create/update to work around Prisma adapter upsert issue)
    const existingStock = await prisma.inventoryStock.findFirst({
        where: {
            catalog_item_id: itemId,
            location_id: locationId,
        },
    });

    if (existingStock) {
        await prisma.inventoryStock.update({
            where: { id: existingStock.id },
            data: {
                quantity_on_hand: { increment: quantity },
            },
        });
    } else {
        await prisma.inventoryStock.create({
            data: {
                catalog_item_id: itemId,
                location_id: locationId,
                quantity_on_hand: quantity,
                quantity_reserved: reserved,
            },
        });
    }
}

async function main() {
    await cleanDb();

    console.log('Seeding Finance Module settings...');
    // Revenue Groups (Austrian standards)
    const revenueGroups = await Promise.all([
        prisma.revenueGroup.upsert({
            where: { name: 'Parts / Goods 20%' },
            update: {},
            create: {
                name: 'Parts / Goods 20%',
                tax_rate: 20.0,
                account_number: '4000',
                is_default: true,
            },
        }),
        prisma.revenueGroup.upsert({
            where: { name: 'Services / Labor 20%' },
            update: {},
            create: {
                name: 'Services / Labor 20%',
                tax_rate: 20.0,
                account_number: '4001',
                is_default: false,
            },
        }),
        prisma.revenueGroup.upsert({
            where: { name: 'Tax Free / Margin' },
            update: {},
            create: {
                name: 'Tax Free / Margin',
                tax_rate: 0.0,
                account_number: '4099',
                is_default: false,
            },
        }),
    ]);

    // Default Finance Settings
    await prisma.financeSettings.upsert({
        where: { id: 1 },
        update: {},
        create: {
            id: 1,
            fiscal_year_start_month: 1,
            lock_date: null,
            next_invoice_number: 1001,
            invoice_prefix: 'RE-2026-',
        },
    });

    const defaultRevenueGroup = revenueGroups[0];

    console.log('Seeding Brands...');

    // Dual Brands (Both Vehicle Make and Part Manufacturer)
    const dualBrands = ['Volkswagen', 'Audi', 'BMW', 'Mercedes-Benz', 'Porsche'];
    const dualBrandRecords = await Promise.all(
        dualBrands.map(name =>
            prisma.brand.create({
                data: { name, isVehicleMake: true, isPartManufacturer: true }
            })
        )
    );

    // Pure Vehicle Makes
    const pureVehicleMakes = ['Toyota', 'Ford', 'Skoda', 'Seat'];
    const pureVehicleMakeRecords = await Promise.all(
        pureVehicleMakes.map(name =>
            prisma.brand.create({
                data: { name, isVehicleMake: true, isPartManufacturer: false }
            })
        )
    );

    // Pure Part Manufacturers
    const purePartManufacturers = ['Bosch', 'Mahle', 'Mann-Filter', 'Castrol', 'NGK', 'Valeo', 'Hella', 'Continental', 'ZF'];
    const purePartManufacturerRecords = await Promise.all(
        purePartManufacturers.map(name =>
            prisma.brand.create({
                data: { name, isVehicleMake: false, isPartManufacturer: true }
            })
        )
    );

    const allBrands = [...dualBrandRecords, ...pureVehicleMakeRecords, ...purePartManufacturerRecords];

    console.log('Seeding warehouses...');
    const showroom = await prisma.storageLocation.create({
        data: {
            name: 'Main Showroom (Vienna)',
            code: 'WH-VIE-01',
            type: LocationType.warehouse,
        },
    });

    const storage = await prisma.storageLocation.create({
        data: {
            name: 'Workshop Storage (Graz)',
            code: 'WH-GRZ-01',
            type: LocationType.warehouse,
        },
    });

    const tireHotel = await prisma.storageLocation.create({
        data: {
            name: 'Tire Hotel (Basement)',
            code: 'WH-TIRE-01',
            type: LocationType.warehouse,
        },
    });

    const locations = [showroom, storage, tireHotel];

    console.log('Seeding supersession items (Phase 1: Creation)...');
    const vwBrand = allBrands.find(b => b.name === 'Volkswagen');

    const partA = await prisma.catalogItem.create({
        data: {
            sku: '06J-115-403-C',
            name: 'Oil Filter (Legacy)',
            cost_price: 8.50,
            retail_price: 15.00,
            revenue_group_id: defaultRevenueGroup.id,
            brand_id: vwBrand?.id,
        },
    });

    const partB = await prisma.catalogItem.create({
        data: {
            sku: '06J-115-403-Q',
            name: 'Oil Filter (Improved)',
            cost_price: 9.00,
            retail_price: 16.50,
            revenue_group_id: defaultRevenueGroup.id,
            brand_id: vwBrand?.id,
        },
    });

    const partC = await prisma.catalogItem.create({
        data: {
            sku: '06J-115-561-B',
            name: 'Oil Filter (Current)',
            cost_price: 10.20,
            retail_price: 18.00,
            revenue_group_id: defaultRevenueGroup.id,
            brand_id: vwBrand?.id,
        },
    });

    console.log('Seeding supersession items (Phase 2: Linking)...');
    await prisma.catalogItem.update({
        where: { id: partA.id },
        data: { superseded_by_id: partB.id },
    });

    await prisma.catalogItem.update({
        where: { id: partB.id },
        data: { superseded_by_id: partC.id },
    });

    console.log('Seeding 47 more auto parts...');
    const categories = [
        { name: 'Oil Filter', prefix: 'OF' },
        { name: 'Brake Pads', prefix: 'BP' },
        { name: 'Synthetic Oil (5W-30)', prefix: 'OIL' },
        { name: 'Wiper Blades', prefix: 'WB' },
        { name: 'Spark Plug', prefix: 'SP' },
        { name: 'Air Filter', prefix: 'AF' },
    ];

    const otherParts: any[] = [];
    for (let i = 1; i <= 47; i++) {
        const brandsForParts = allBrands.filter(b => b.isPartManufacturer);
        const brand = brandsForParts[Math.floor(Math.random() * brandsForParts.length)];
        const category = categories[Math.floor(Math.random() * categories.length)];
        const sku = `${category.prefix}-${1000 + i}-${brand.name.substring(0, 3).toUpperCase()}`;

        const part = await prisma.catalogItem.create({
            data: {
                sku,
                name: `${category.name} - ${brand.name} model ${i}`,
                cost_price: Math.random() * 50 + 10,
                retail_price: Math.random() * 100 + 60,
                revenue_group_id: defaultRevenueGroup.id,
                brand_id: brand.id,
            },
        });
        otherParts.push(part);
    }

    console.log('Seeding stock using ledger-based transactions...');
    // Only Part C has stock (using transaction-based approach)
    await recordInitialStock(
        partC.id,
        showroom.id,
        25,
        Number(partC.cost_price),
        2 // reserved quantity
    );

    // Random stock for other parts (using transaction-based approach)
    for (const part of otherParts) {
        if (Math.random() > 0.3) {
            const quantity = Math.floor(Math.random() * 50) + 1;
            const reserved = Math.floor(Math.random() * 5);
            const location = locations[Math.floor(Math.random() * locations.length)];

            await recordInitialStock(
                part.id,
                location.id,
                quantity,
                Number(part.cost_price),
                reserved
            );
        }
    }

    console.log('Seeding Vendors...');
    const vendors = await Promise.all([
        prisma.vendor.create({
            data: {
                name: 'AutoParts Wholesale Ltd.',
                email: 'sales@autoparts-wholesale.com',
                account_number: 'VEND-101',
                supportedBrands: { connect: dualBrandRecords.slice(0, 3).map(b => ({ id: b.id })) }
            }
        }),
        prisma.vendor.create({
            data: {
                name: 'Genuine Components Austria',
                email: 'orders@genuine-comp.at',
                account_number: 'VEND-202',
                supportedBrands: { connect: purePartManufacturerRecords.slice(0, 5).map(b => ({ id: b.id })) }
            }
        })
    ]);

    console.log('Seeding Customers and Vehicles...');
    const customers = await Promise.all([
        prisma.customer.create({
            data: {
                first_name: 'Max',
                last_name: 'Mustermann',
                email: 'max.mustermann@example.at',
                phone: '+43 664 1234567',
                type: CustomerType.PRIVATE,
                address_street: 'Hauptstraße 1',
                address_city: 'Wien',
                address_zip: '1010',
                vehicles: {
                    create: [
                        { make: 'Volkswagen', model: 'Golf VIII', year: 2022, vin: 'WVWZZZCDZMW123456', plate: 'W-12345-X' },
                        { make: 'Audi', model: 'A4 Avant', year: 2020, vin: 'WAUZZZF4ZLA654321', plate: 'W-54321-Y' }
                    ]
                }
            },
            include: { vehicles: true }
        }),
        prisma.customer.create({
            data: {
                first_name: 'Anna',
                last_name: 'Schmidt',
                email: 'anna.schmidt@business.com',
                company_name: 'Schmidt Consulting GmbH',
                type: CustomerType.COMPANY,
                vat_id: 'ATU12345678',
                address_street: 'Gewerbepark 5',
                address_city: 'Graz',
                address_zip: '8010',
                vehicles: {
                    create: [
                        { make: 'BMW', model: '520d Touring', year: 2023, vin: 'WBA51AF0X0L112233', plate: 'G-98765-Z' }
                    ]
                }
            },
            include: { vehicles: true }
        }),
        prisma.customer.create({
            data: {
                first_name: 'Thomas',
                last_name: 'Gruber',
                email: 'thomas.gruber@private.at',
                type: CustomerType.PRIVATE,
                vehicles: {
                    create: [
                        { make: 'Toyota', model: 'Corolla', year: 2018, vin: 'JTNB10K500334455', plate: 'P-11223-A' }
                    ]
                }
            },
            include: { vehicles: true }
        })
    ]);

    console.log('Seeding Sales Orders...');
    const customer1 = customers[0];
    const customer2 = customers[1];

    const salesOrders = await Promise.all([
        prisma.salesOrder.create({
            data: {
                order_number: 'SO-2026-1001',
                customer_id: customer1.id,
                vehicle_id: customer1.vehicles[0].id,
                status: SalesOrderStatus.CONFIRMED,
                total_amount: 150.00,
                notes: 'Brake pad replacement scheduled',
                items: {
                    create: [
                        {
                            description: 'Front Brake Pads (A-Grade)',
                            quantity: 1,
                            unit_price: 125.00,
                            total: 125.00,
                            tax_rate: 20.0,
                        },
                        {
                            description: 'Labor (30 min)',
                            quantity: 0.5,
                            unit_price: 50.00,
                            total: 25.00,
                            tax_rate: 20.0,
                        }
                    ]
                }
            }
        }),
        prisma.salesOrder.create({
            data: {
                order_number: 'SO-2026-1002',
                customer_id: customer2.id,
                vehicle_id: customer2.vehicles[0].id,
                status: SalesOrderStatus.DRAFT,
                total_amount: 85.50,
                items: {
                    create: [
                        {
                            description: 'Oil Filter Replacement',
                            quantity: 1,
                            unit_price: 85.50,
                            total: 85.50,
                            tax_rate: 20.0,
                        }
                    ]
                }
            }
        })
    ]);

    console.log('Seeding Workshop Orders (Intake)...');
    await prisma.workshopOrder.create({
        data: {
            customer_id: customer1.id,
            vehicle_id: customer1.vehicles[1].id,
            status: WorkshopOrderStatus.INTAKE,
            odometer: 45678,
            fuel_level: 75,
            notes: 'Customer reports unusual noise when braking'
        }
    });

    console.log('Seeding Purchase Orders...');
    const vendor1 = vendors[0];
    await prisma.purchaseOrder.create({
        data: {
            order_number: 'PO-2026-001',
            vendor_id: vendor1.id,
            status: PurchaseOrderStatus.SENT,
            items: {
                create: [
                    {
                        catalog_item_id: otherParts[0].id,
                        quantity: 10,
                        unit_cost: 15.50,
                    },
                    {
                        catalog_item_id: otherParts[1].id,
                        quantity: 5,
                        unit_cost: 42.00,
                    }
                ]
            }
        }
    });

    console.log('Seed completed successfully!');
    console.log('✓ All inventory movements recorded as transactions');
    console.log('✓ Stock cache updated accordingly');
    console.log('✓ Revenue groups and default finance settings created');
    console.log('✓ Brands (Dual/Pure) created and linked to items');
    console.log('✓ Vendors and linked brands created');
    console.log('✓ Customers and Vehicles created');
    console.log('✓ Sales Orders, Workshop Orders and Purchase Orders created');
}

main()
    .catch((e) => {
        console.error('SEED_FAILURE_START');
        console.error(e);
        if (e.code) console.error('Error Code:', e.code);
        if (e.meta) console.error('Error Meta:', JSON.stringify(e.meta));
        console.error('SEED_FAILURE_END');
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });