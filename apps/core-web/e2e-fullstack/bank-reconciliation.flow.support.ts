import { expect, type APIRequestContext } from '@playwright/test'
import { E2E_FULLSTACK_API_PORT } from '../../core-api/test/e2e-fullstack/constants.ts'
import type { E2eFullstackFixture } from '../../core-api/test/e2e-fullstack/seed-fixture.ts'

function buildCamt053Xml(params: {
  receivingIban: string
  statementId: string
  entries: Array<{
    amount: string
    bookingDate: string
    bankRef: string
    remitterName: string
    referenceText: string
  }>
}): Buffer {
  const entryXml = params.entries
    .map(
      (entry) => `
      <Ntry>
        <Amt Ccy="EUR">${entry.amount}</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>${entry.bookingDate}</Dt></BookgDt>
        <AcctSvcrRef>${entry.bankRef}</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <RltdPties>
              <Dbtr><Nm>${entry.remitterName}</Nm></Dbtr>
            </RltdPties>
            <RmtInf><Ustrd>${entry.referenceText}</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>`,
    )
    .join('\n')

  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>${params.statementId}</Id>
      <Acct><Id><IBAN>${params.receivingIban}</IBAN></Id></Acct>
      ${entryXml}
    </Stmt>
  </BkToCstmrStmt>
</Document>`,
    'utf8',
  )
}

export async function seedBankReconciliationScenario(
  request: APIRequestContext,
  fixture: E2eFullstackFixture,
) {
  const apiBase = `http://127.0.0.1:${E2E_FULLSTACK_API_PORT}/api`
  const headers = { Authorization: `Bearer ${fixture.authToken}` }

  const ownerHeaders = { Authorization: `Bearer ${fixture.ownerAuthToken}` }
  const getSettingsRes = await request.get(`${apiBase}/finance/settings`, {
    headers: ownerHeaders,
  })
  expect(getSettingsRes.ok(), `GET /finance/settings failed: ${getSettingsRes.status()} ${await getSettingsRes.text()}`).toBeTruthy()

  const settingsRes = await request.patch(`${apiBase}/finance/settings`, {
    headers: ownerHeaders,
    data: { bank_reconciliation_enabled: true },
  })
  expect(settingsRes.ok(), `PATCH /finance/settings failed: ${settingsRes.status()} ${await settingsRes.text()}`).toBeTruthy()

  const entitiesRes = await request.get(`${apiBase}/legal-entities`, { headers })
  expect(entitiesRes.ok(), `GET /legal-entities failed: ${entitiesRes.status()} ${await entitiesRes.text()}`).toBeTruthy()
  const entities = (await entitiesRes.json()) as Array<{ id: string; iban?: string | null }>
  const receivingIban = entities.find((e) => e.iban)?.iban ?? 'AT611904300234573201'
  if (!entities[0]?.iban && entities[0]?.id) {
    const patchEntity = await request.patch(`${apiBase}/legal-entities/${entities[0].id}`, {
      headers,
      data: { iban: receivingIban },
    })
    expect(patchEntity.ok(), `PATCH /legal-entities failed: ${patchEntity.status()} ${await patchEntity.text()}`).toBeTruthy()
  }

  const orderRes = await request.post(`${apiBase}/sales-orders`, {
    headers,
    data: {
      customer_id: fixture.customerId,
      items: [
        {
          catalog_item_id: fixture.catalogItemId,
          description: fixture.catalogName,
          quantity: 1,
          unit_price: 100,
          tax_rate: 20,
        },
      ],
    },
  })
  expect(orderRes.ok(), `POST /sales-orders failed: ${orderRes.status()} ${await orderRes.text()}`).toBeTruthy()
  const order = (await orderRes.json()) as { id: string }

  const createInvRes = await request.post(`${apiBase}/sales-orders/${order.id}/create-invoice`, { headers })
  expect(createInvRes.ok(), `POST /create-invoice failed: ${createInvRes.status()} ${await createInvRes.text()}`).toBeTruthy()
  const draftInvoice = (await createInvRes.json()) as { id: string }

  const finalizeRes = await request.put(`${apiBase}/sales/invoices/${draftInvoice.id}/finalize`, { headers })
  expect(finalizeRes.ok(), `PUT /finalize failed: ${finalizeRes.status()} ${await finalizeRes.text()}`).toBeTruthy()
  const issuedInvoice = (await finalizeRes.json()) as {
    id: string
    invoice_number: string
    total_gross: string
    date: string
  }

  const issuedDate = new Date(issuedInvoice.date)
  const bookingDate = issuedDate.toISOString().slice(0, 10)
  const earlierBookingDate = new Date(issuedDate.getTime() - 86_400_000).toISOString().slice(0, 10)
  const xml = buildCamt053Xml({
    receivingIban,
    statementId: `STMT-${Date.now()}`,
    entries: [
      {
        amount: Number(issuedInvoice.total_gross).toFixed(2),
        bookingDate,
        bankRef: `REF-1-${Date.now()}`,
        remitterName: 'Max Muster',
        referenceText: `Zahlung ${issuedInvoice.invoice_number}`,
      },
      {
        amount: '42.00',
        bookingDate: earlierBookingDate,
        bankRef: `REF-2-${Date.now()}`,
        remitterName: 'Zweiter Auftraggeber',
        referenceText: 'Sonstige Zahlung',
      },
    ],
  })

  const importRes = await request.post(`${apiBase}/bank-reconciliation/imports`, {
    headers,
    multipart: {
      file: {
        name: 'statement.xml',
        mimeType: 'application/xml',
        buffer: xml,
      },
    },
  })
  expect(importRes.ok(), `POST /bank-reconciliation/imports failed: ${importRes.status()} ${await importRes.text()}`).toBeTruthy()

  return {
    apiBase,
    headers,
    invoiceId: issuedInvoice.id,
    invoiceNumber: issuedInvoice.invoice_number,
  }
}
