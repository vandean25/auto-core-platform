import { BadRequestException } from '@nestjs/common';
import { parseCamt053 } from './camt053.parser.js';

const VALID_CAMT053 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>STMT-2026-001</Id>
      <Acct>
        <Id>
          <IBAN>AT61 1904 3002 3457 3201</IBAN>
        </Id>
      </Acct>
      <Ntry>
        <Amt Ccy="EUR">1250.50</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-11-10</Dt></BookgDt>
        <ValDt><Dt>2026-11-10</Dt></ValDt>
        <AcctSvcrRef>BANK-REF-001</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <RltdPties>
              <Dbtr><Nm>Muster GmbH</Nm></Dbtr>
              <DbtrAcct><Id><IBAN>at48 3200 0000 1234 5864</IBAN></Id></DbtrAcct>
            </RltdPties>
            <RmtInf>
              <Ustrd>Rechnung RE-2026-0042</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">89.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-11-11</Dt></BookgDt>
        <AcctSvcrRef>BANK-REF-DEBIT-1</AcctSvcrRef>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-11-12</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs><TxId>TX-CHF-002</TxId></Refs>
            <RmtInf><Strd><CdtrRefInf><Ref>RF18539007547034</Ref></CdtrRefInf></Strd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">100.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>PDNG</Sts>
        <BookgDt><Dt>2026-11-13</Dt></BookgDt>
        <AcctSvcrRef>PENDING-001</AcctSvcrRef>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe('parseCamt053', () => {
  it('parses booked credits and debits, normalizes IBANs, and flags non-EUR credits', () => {
    const result = parseCamt053(VALID_CAMT053);
    expect(result.statements).toHaveLength(1);
    const stmt = result.statements[0];
    expect(stmt.statementId).toBe('STMT-2026-001');
    expect(stmt.receivingIban).toBe('AT611904300234573201');
    expect(stmt.entries).toHaveLength(3);

    expect(stmt.entries[0]).toEqual({
      isCredit: true,
      amount: '1250.50',
      currency: 'EUR',
      nonEur: false,
      bookingDate: '2026-11-10',
      valueDate: '2026-11-10',
      bankRef: 'BANK-REF-001',
      remitterName: 'Muster GmbH',
      remitterIban: 'AT483200000012345864',
      referenceText: 'Rechnung RE-2026-0042',
    });

    expect(stmt.entries[1]).toMatchObject({
      isCredit: false,
      amount: '89.00',
      currency: 'EUR',
      nonEur: false,
      bankRef: 'BANK-REF-DEBIT-1',
    });

    expect(stmt.entries[2]).toMatchObject({
      isCredit: true,
      amount: '500.00',
      currency: 'CHF',
      nonEur: true,
      bankRef: 'TX-CHF-002',
      referenceText: 'RF18539007547034',
    });
  });

  it('rejects a credit entry that lacks a stable bank reference', () => {
    const missingRefXml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
      <BkToCstmrStmt><Stmt><Acct><Id><IBAN>AT611904300234573201</IBAN></Id></Acct>
        <Ntry><Amt Ccy="EUR">50.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-10</Dt></BookgDt></Ntry>
      </Stmt></BkToCstmrStmt></Document>`;
    expect(() => parseCamt053(missingRefXml)).toThrow(BadRequestException);
  });

  it('rejects XML with DOCTYPE/ENTITY declarations and non-camt.053 namespaces', () => {
    expect(() =>
      parseCamt053('<!DOCTYPE foo [<!ENTITY xxe "test">]><Document/>'),
    ).toThrow(BadRequestException);
    expect(() =>
      parseCamt053(
        '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>',
      ),
    ).toThrow(BadRequestException);
  });
});
