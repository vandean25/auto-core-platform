import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

async function run() {
    try {
        console.log('1. Creating Vendor...');
        const vendorRes = await axios.post(`${API_URL}/vendors`, {
            name: 'Test Vendor ' + Date.now(),
            email: 'test@vendor.com',
            accountNumber: 'TEST-123',
            supportedBrands: ['VW', 'Audi', 'Castrol', 'Bosch', 'Mahle', 'Brembo', 'Shell', 'NGK', 'Valeo']
        });
        const vendor = vendorRes.data;
        console.log('   Vendor created:', vendor.id);

        console.log('2. Fetching Catalog Items...');
        // We need an item ID. Let's fetch one.
        // Assuming search endpoint works or list works.
        // Actually existing inventory controller might not have list all without params?
        // Let's try searching 'a' or just fetching via prisma if we could, but let's try API.
        const inventoryRes = await axios.get(`${API_URL}/inventory?limit=1`);
        const item = inventoryRes.data.data[0];
        if (!item) {
            console.error('No items in inventory to order!');
            return;
        }
        console.log('   Found item:', item.sku);

        console.log('3. Creating Purchase Order...');
        const poRes = await axios.post(`${API_URL}/purchase-orders`, {
            vendorId: vendor.id,
            items: [
                { catalogItemId: item.id, quantity: 10, unitCost: 100 }
            ]
        });
        const po = poRes.data;
        console.log('   PO created:', po.id, po.status);

        console.log('4. Receiving Goods (Partial)...');
        await axios.post(`${API_URL}/purchase-orders/${po.id}/receive`, {
            items: [
                { itemId: item.id, quantity: 5 }
            ]
        });
        console.log('   Goods received.');

        console.log('5. Verifying PO Status...');
        // Currently relying on my memory of endpoints. I didn't explicitly create GET /purchase-orders/:id in controller?
        // Wait, I checked PurchaseController in step 630.
        // It has:
        // @Post() createPurchaseOrder
        // @Post(':id/receive') receiveItems
        // IT DOES NOT HAVE @Get(':id') !!! 
        // I missed adding the GET endpoints in the backend!

        // I need to add GET endpoints to PurchaseController NOW.

        console.log('   (Skipping GET check as endpoint might be missing, checking via Receive response if possible?)');
        // Actually receiveItems returns updatedPO.
        // But I really need to fix the backend first.
    } catch (error: any) {
        console.error('Error Status:', error.response?.status);
        console.error('Error Data:', error.response?.data);
        console.error('Error Message:', error.message);
    }
}

run();
