const { Client } = require('pg');

async function checkPort(port) {
    const client = new Client({
        connectionString: `postgres://postgres:postgres@[::1]:${port}/template1?sslmode=disable`
    });

    try {
        await client.connect();
        console.log(`Port ${port}: SUCCESS - Connected to Postgres`);
        await client.end();
    } catch (err) {
        console.log(`Port ${port}: FAILED - ${err.message}`);
    }
}

async function main() {
    await checkPort(51213);
    await checkPort(51214);
    await checkPort(51215);
}

main();
