import 'dotenv/config';
import { PrismaClient, LocationType, TransactionType } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedFixedStagingTotes } from '../src/prisma/seed-staging-totes';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function tableExists(tableName: string): Promise<boolean> {
    const result = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE  table_schema = 'public'
            AND    table_name   = '${tableName}'
        );`
    );
    return result[0]?.exists || false;
}

async function cleanDb() {
    console.log('Cleaning database...');
    
    const tables = [
        'tenants',
        'purchase_invoice_lines', 'purchase_invoices', 'purchase_order_items', 'purchase_orders',
        'vendors', 'inventory_transactions', 'inventory_stocks', 'invoice_items', 'invoices',
        'catalog_items', 'storage_locations', 'revenue_groups', 'finance_settings', 'brands',
        'labor_operations', 'labor_categories', 'workshop_orders', 'vehicles', 'customers'
    ];

    const existingTables = new Set<string>();
    for (const table of tables) {
        if (await tableExists(table)) {
            existingTables.add(table);
        }
    }

    // Delete in order to satisfy foreign key constraints
    if (existingTables.has('tenants')) await prisma.tenant.deleteMany();
    if (existingTables.has('purchase_invoice_lines')) await prisma.purchaseInvoiceLine.deleteMany();
    if (existingTables.has('purchase_invoices')) await prisma.purchaseInvoice.deleteMany();
    if (existingTables.has('purchase_order_items')) await prisma.purchaseOrderItem.deleteMany();
    if (existingTables.has('purchase_orders')) await prisma.purchaseOrder.deleteMany();
    if (existingTables.has('inventory_transactions')) await prisma.inventoryTransaction.deleteMany();
    if (existingTables.has('inventory_stocks')) await prisma.inventoryStock.deleteMany();
    if (existingTables.has('invoice_items')) await prisma.invoiceItem.deleteMany();
    if (existingTables.has('invoices')) await prisma.invoice.deleteMany();
    if (existingTables.has('catalog_items')) await prisma.catalogItem.deleteMany();
    if (existingTables.has('storage_locations')) await prisma.storageLocation.deleteMany();
    if (existingTables.has('revenue_groups')) await prisma.revenueGroup.deleteMany();
    if (existingTables.has('finance_settings')) await prisma.financeSettings.deleteMany();
    if (existingTables.has('labor_operations')) await prisma.laborOperation.deleteMany();
    if (existingTables.has('labor_categories')) {
        await prisma.laborCategory.deleteMany({ where: { parent_id: { not: null } } });
        await prisma.laborCategory.deleteMany();
    }
    // workshop_orders cascade-deletes workshop_tasks and workshop_task_line_items
    if (existingTables.has('workshop_orders')) await prisma.workshopOrder.deleteMany();
    if (existingTables.has('vehicles')) await prisma.vehicle.deleteMany();
    if (existingTables.has('customers')) await prisma.customer.deleteMany();
    if (existingTables.has('vendors')) await prisma.vendor.deleteMany();
    if (existingTables.has('brands')) await prisma.brand.deleteMany();
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

    console.log('Seeding tenant foundation...');
    await prisma.tenant.upsert({
        where: { slug: 'default-workshop' },
        update: {},
        create: {
            name: 'Default Workshop',
            slug: 'default-workshop',
            plan: 'STANDARD',
        },
    });

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
    const currentYear = new Date().getFullYear();
    await prisma.financeSettings.upsert({
        where: { id: 1 },
        update: {},
        create: {
            id: 1,
            fiscal_year_start_month: 1,
            lock_date: null,
            next_invoice_number: 1001,
            invoice_prefix: `RE-${currentYear}-`,
            next_workshop_order_number: 1,
            workshop_order_prefix: `WO-${currentYear}-`,
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

    console.log('Seeding fixed staging totes...');
    const stagingToteSummary = await seedFixedStagingTotes(prisma, {
        parentLocationId: storage.id,
    });
    console.log(
        `Staging totes summary: created=${stagingToteSummary.created}, updated=${stagingToteSummary.updated}, unchanged=${stagingToteSummary.unchanged}`,
    );

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

    console.log('Seeding Labor Categories and Operations...');

    // Create the 6 top-level labor categories
    const categoriesToSeed = [
        { name: 'Engine', description: 'Engine and internal combustion system operations', sort_order: 1 },
        { name: 'Brakes', description: 'Brake system inspection and replacement operations', sort_order: 2 },
        { name: 'Electrical', description: 'Electrical system diagnostics and repairs', sort_order: 3 },
        { name: 'Suspension', description: 'Suspension, steering, and chassis operations', sort_order: 4 },
        { name: 'Transmission', description: 'Gearbox, clutch, and drivetrain operations', sort_order: 5 },
        { name: 'General Service', description: 'Routine vehicle servicing and inspection operations', sort_order: 6 },
    ];

    const categoryRecords = await Promise.all(
        categoriesToSeed.map(cat =>
            prisma.laborCategory.upsert({
                where: { name: cat.name },
                update: {
                    description: cat.description,
                    sort_order: cat.sort_order,
                },
                create: cat,
            })
        )
    );

    const [catEngine, catBrakes, catElectrical, catSuspension, catTransmission, catGeneral] = categoryRecords;

    // Map code prefix → category ID for automatic categorization
    const categoryByPrefix: Record<string, string> = {
        'ENG':   catEngine.id,
        'BRK':   catBrakes.id,
        'ELEC':  catElectrical.id,
        'SUS':   catSuspension.id,
        'TRANS': catTransmission.id,
        'GEN':   catGeneral.id,
    };

    /** Resolve category_id from an operation code prefix, or null if no match. */
    function resolveCategoryId(code: string): string | null {
        for (const prefix of Object.keys(categoryByPrefix)) {
            if (code.startsWith(prefix + '-')) {
                return categoryByPrefix[prefix];
            }
        }
        return null;
    }

    const laborOperationDefs = [
        // Engine
        { code: 'ENG-001', description: 'Engine Oil & Filter Change',            standard_aw: 0.5, hourly_rate: 95.00 },
        { code: 'ENG-002', description: 'Timing Belt Replacement',                standard_aw: 4.0, hourly_rate: 95.00 },
        { code: 'ENG-003', description: 'Engine Diagnostic Scan',                 standard_aw: 0.5, hourly_rate: 95.00 },
        { code: 'ENG-004', description: 'Valve Cover Gasket Replacement',         standard_aw: 2.0, hourly_rate: 95.00 },
        // Brakes
        { code: 'BRK-001', description: 'Front Brake Pad Replacement',            standard_aw: 1.0, hourly_rate: 95.00 },
        { code: 'BRK-002', description: 'Rear Brake Pad Replacement',             standard_aw: 1.0, hourly_rate: 95.00 },
        { code: 'BRK-003', description: 'Brake Disc Replacement (Front Axle)',    standard_aw: 1.5, hourly_rate: 95.00 },
        { code: 'BRK-004', description: 'Brake Fluid Flush',                      standard_aw: 0.5, hourly_rate: 95.00 },
        // Electrical
        { code: 'ELEC-001', description: 'Battery Replacement & Registration',    standard_aw: 0.5, hourly_rate: 95.00 },
        { code: 'ELEC-002', description: 'Alternator Replacement',                standard_aw: 2.5, hourly_rate: 95.00 },
        { code: 'ELEC-003', description: 'Starter Motor Replacement',             standard_aw: 2.0, hourly_rate: 95.00 },
        { code: 'ELEC-004', description: 'Electrical System Diagnostics',         standard_aw: 1.0, hourly_rate: 95.00 },
        // Suspension
        { code: 'SUS-001', description: 'Front Shock Absorber Replacement (per side)', standard_aw: 1.5, hourly_rate: 95.00 },
        { code: 'SUS-002', description: 'Rear Shock Absorber Replacement (per side)',  standard_aw: 1.5, hourly_rate: 95.00 },
        { code: 'SUS-003', description: 'Four-Wheel Alignment',                   standard_aw: 1.0, hourly_rate: 95.00 },
        { code: 'SUS-004', description: 'Front Control Arm Replacement',          standard_aw: 2.0, hourly_rate: 95.00 },
        // Transmission
        { code: 'TRANS-001', description: 'Manual Gearbox Oil Change',            standard_aw: 0.5, hourly_rate: 95.00 },
        { code: 'TRANS-002', description: 'Clutch Kit Replacement',               standard_aw: 5.0, hourly_rate: 95.00 },
        { code: 'TRANS-003', description: 'Transmission Fault Diagnosis',         standard_aw: 1.0, hourly_rate: 95.00 },
        { code: 'TRANS-004', description: 'Automatic Transmission Fluid Service', standard_aw: 1.0, hourly_rate: 95.00 },
        // General Service
        { code: 'GEN-001', description: 'Annual Service – Minor (Oil, Filter, Check)', standard_aw: 1.0, hourly_rate: 95.00 },
        { code: 'GEN-002', description: 'Annual Service – Major (Full Inspection)',     standard_aw: 2.5, hourly_rate: 95.00 },
        { code: 'GEN-003', description: 'Pre-MOT / TÜV Inspection',              standard_aw: 1.5, hourly_rate: 95.00 },
        { code: 'GEN-004', description: 'Cabin & Engine Air Filter Replacement',  standard_aw: 0.5, hourly_rate: 95.00 },
        { code: 'GEN-005', description: 'Wheel Change (Summer/Winter)',           standard_aw: 0.8, hourly_rate: 95.00 },
    ];

    await Promise.all(
        laborOperationDefs.map(op =>
            prisma.laborOperation.upsert({
                where: { code: op.code },
                update: {
                    description: op.description,
                    standard_aw: op.standard_aw,
                    hourly_rate: op.hourly_rate,
                    category_id: resolveCategoryId(op.code),
                },
                create: {
                    code: op.code,
                    description: op.description,
                    standard_aw: op.standard_aw,
                    hourly_rate: op.hourly_rate,
                    category_id: resolveCategoryId(op.code),
                },
            })
        )
    );

    console.log('Categorizing all existing LaborOperation records...');
    const allOperations = await prisma.laborOperation.findMany({
        where: { category_id: null }
    });

    let categorizedCount = 0;
    for (const op of allOperations) {
        const catId = resolveCategoryId(op.code);
        if (catId) {
            await prisma.laborOperation.update({
                where: { id: op.id },
                data: { category_id: catId }
            });
            categorizedCount++;
        }
    }

    console.log('Seeding Vendors (one per brand)...');
    await Promise.all(
        allBrands.map((brand) =>
            prisma.vendor.create({
                data: {
                    name: `${brand.name} Parts Direct`,
                    email: `sales@${brand.name.toLowerCase().replace(/\s+/g, '-')}-parts.com`,
                    account_number: `VEND-${brand.name.substring(0, 3).toUpperCase()}`,
                    supportedBrands: {
                        connect: { id: brand.id }
                    }
                }
            })
        )
    );

    console.log('Seeding Customers and Vehicles...');
    const customersData = [
        {
            first_name: 'Max',
            last_name: 'Mustermann',
            email: 'max@example.at',
            phone: '+43 664 1234567',
            address_street: 'Stephansplatz 1',
            address_city: 'Vienna',
            address_zip: '1010',
            vehicles: [
                { make: 'Volkswagen', model: 'Golf VII', year: 2018, plate: 'W-12345AB', vin: 'VWZZZ12345678901' }
            ]
        },
        {
            first_name: 'Susi',
            last_name: 'Sorglos',
            email: 'susi@sorglos.at',
            phone: '+43 676 9876543',
            address_street: 'Mariahilfer Straße 50',
            address_city: 'Vienna',
            address_zip: '1070',
            vehicles: [
                { make: 'Audi', model: 'A4 B9', year: 2020, plate: 'W-98765XY', vin: 'WAUZZZ9876543210' },
                { make: 'Porsche', model: '911 Carrera', year: 2022, plate: 'W-911PS', vin: 'WP0ZZZ1112223334' }
            ]
        },
        {
            first_name: 'Thomas',
            last_name: 'Turboschrauber',
            email: 'thomas@tuning.at',
            phone: '+43 650 5554433',
            address_street: 'Grazer Gasse 12',
            address_city: 'Graz',
            address_zip: '8010',
            vehicles: [
                { make: 'BMW', model: 'M3 G80', year: 2023, plate: 'G-TUNER1', vin: 'WBS3334445556667' }
            ]
        },
        {
            first_name: 'Anna',
            last_name: 'Alpin',
            email: 'anna@berge.at',
            phone: '+43 699 1122334',
            address_street: 'Tiroler Weg 7',
            address_city: 'Innsbruck',
            address_zip: '6020',
            vehicles: [
                { make: 'Toyota', model: 'Land Cruiser', year: 2015, plate: 'IL-4WD1', vin: 'JTMLC123456789012' }
            ]
        },
        {
            first_name: 'Klaus',
            last_name: 'Kombi',
            email: 'klaus@logistik.at',
            phone: '+43 680 8877665',
            address_street: 'Salzburger Ring 3',
            address_city: 'Salzburg',
            address_zip: '5020',
            vehicles: [
                { make: 'Skoda', model: 'Octavia IV RS', year: 2021, plate: 'S-SKODA1', vin: 'TMBZZZSK12345678' }
            ]
        }
    ];

    const createdCustomers = await Promise.all(
        customersData.map(({ vehicles: _vehicles, ...customerInfo }) =>
            prisma.customer.create({ data: customerInfo })
        )
    );

    const vehiclesToCreate = customersData.flatMap((data, index) =>
        data.vehicles.map((vehicle) => ({
            ...vehicle,
            customer_id: createdCustomers[index].id,
        }))
    );

    if (vehiclesToCreate.length > 0) {
        await prisma.vehicle.createMany({ data: vehiclesToCreate });
    }

    console.log('Seeding specific LaborFitments (for testing)...');
    const opOilChange = await prisma.laborOperation.findUnique({ where: { code: 'ENG-001' } });
    const opBrakePad = await prisma.laborOperation.findUnique({ where: { code: 'BRK-001' } });

    if (opOilChange) {
        await prisma.laborFitment.create({
            data: {
                labor_operation_id: opOilChange.id,
                make: 'Volkswagen',
                model: 'Golf VII',
                year_from: 2012,
                year_to: 2020,
            }
        });
    }

    if (opBrakePad) {
        await prisma.laborFitment.create({
            data: {
                labor_operation_id: opBrakePad.id,
                make: 'Audi',
                model: 'A4 B9',
                year_from: 2015,
                year_to: 2023,
            }
        });
    }

    console.log('Seed completed successfully!');
    console.log('✓ All inventory movements recorded as transactions');
    console.log('✓ Stock cache updated accordingly');
    console.log('✓ Revenue groups and default finance settings created');
    console.log('✓ Brands (Dual/Pure) created and linked to items');
    console.log(`✓ ${categoryRecords.length} labor categories created/updated`);
    console.log(`✓ ${laborOperationDefs.length} labor operations seeded/updated`);
    console.log(`✓ ${categorizedCount} existing labor operations categorized by prefix`);
    console.log(`✓ ${allBrands.length} vendors created (one per brand)`);
    console.log(`✓ ${customersData.length} customers and their vehicles created`);
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