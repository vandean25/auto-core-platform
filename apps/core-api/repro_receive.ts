
import axios from 'axios';

async function run() {
    const orderId = '68eee589-1e09-4562-868a-f1f805350655';
    try {
        console.log(`Fetching PO ${orderId}...`);
        const poRes = await axios.get(`http://localhost:3000/api/purchase-orders/${orderId}`);
        const po = poRes.data;
        console.log('PO found:', po.order_number);
        console.log('Items:', po.items.map(i => `${i.catalog_item.sku}: ${i.quantity_received}/${i.quantity}`));

        if (po.items.length === 0) {
            console.log('No items in PO');
            return;
        }

        const itemToReceive = po.items[0];
        const payload = {
            items: [{
                itemId: itemToReceive.catalog_item_id,
                quantity: 1
            }]
        };

        console.log('Sending receipt payload:', JSON.stringify(payload, null, 2));
        const res = await axios.post(`http://localhost:3000/api/purchase-orders/${orderId}/receive`, payload);
        console.log('Success:', res.data);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error('API Error:', error.response?.status, error.response?.statusText);
            console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
        } else {
            console.error('Error:', error);
        }
    }
}

run();
