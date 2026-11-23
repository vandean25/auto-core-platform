import { BadRequestException } from '@nestjs/common';

export type ParsedCamt053Entry = {
  isCredit: boolean;
  amount: string;
  currency: string;
  nonEur: boolean;
  bookingDate: string;
  valueDate: string | null;
  bankRef: string;
  remitterName: string | null;
  remitterIban: string | null;
  referenceText: string | null;
};

export type ParsedCamt053Statement = {
  statementId: string | null;
  receivingIban: string;
  entries: ParsedCamt053Entry[];
};

export type ParsedCamt053File = {
  statements: ParsedCamt053Statement[];
};

type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

function decodeXmlEntities(input: string): string {
  return input.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,
    (_, entity: string) => {
      if (entity === 'amp') return '&';
      if (entity === 'lt') return '<';
      if (entity === 'gt') return '>';
      if (entity === 'quot') return '"';
      if (entity === 'apos') return "'";
      if (entity.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    },
  );
}

function stripNamespacePrefix(tagName: string): string {
  const colon = tagName.indexOf(':');
  return colon >= 0 ? tagName.slice(colon + 1) : tagName;
}

function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of rawAttrs.matchAll(attrRegex)) {
    const key = stripNamespacePrefix(match[1]);
    attrs[key] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function handleClosingTag(stack: XmlNode[], tagContent: string): void {
  const closingName = stripNamespacePrefix(tagContent.slice(1).trim());
  const top = stack.pop();
  if (!top || top.name !== closingName) {
    throw new BadRequestException(
      `Malformed XML: unexpected closing tag </${closingName}>.`,
    );
  }
}

function handleOpeningTag(stack: XmlNode[], tagContent: string): void {
  const selfClosing = tagContent.endsWith('/');
  const body = selfClosing ? tagContent.slice(0, -1).trim() : tagContent;
  const spaceIdx = body.search(/\s/);
  const rawName = spaceIdx >= 0 ? body.slice(0, spaceIdx) : body;
  const rawAttrs = spaceIdx >= 0 ? body.slice(spaceIdx + 1) : '';
  const node: XmlNode = {
    name: stripNamespacePrefix(rawName),
    attrs: parseAttributes(rawAttrs),
    children: [],
    text: '',
  };
  stack[stack.length - 1].children.push(node);
  if (!selfClosing) {
    stack.push(node);
  }
}

function parseXmlDocument(xml: string): XmlNode {
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new BadRequestException(
      'XML DOCTYPE and ENTITY declarations are not permitted.',
    );
  }
  const cleaned = xml
    .replace(/^\uFEFF/, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (!cleaned) {
    throw new BadRequestException('Bank statement XML is empty.');
  }

  const root: XmlNode = { name: '__root__', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tokenRegex = /<!\[CDATA\[([\s\S]*?)\]\]>|<([^>]+)>|([^<]+)/g;

  for (const match of cleaned.matchAll(tokenRegex)) {
    if (match[1] !== undefined) {
      stack[stack.length - 1].text += match[1];
    } else if (match[3] !== undefined) {
      stack[stack.length - 1].text += decodeXmlEntities(match[3]);
    } else {
      const tagContent = match[2].trim();
      if (tagContent.startsWith('/')) {
        handleClosingTag(stack, tagContent);
      } else if (tagContent) {
        handleOpeningTag(stack, tagContent);
      }
    }
  }

  if (stack.length !== 1 || root.children.length !== 1) {
    throw new BadRequestException('Malformed XML: unclosed or missing root.');
  }
  return root.children[0];
}

function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? [];
}

function textOf(node: XmlNode | undefined): string | null {
  if (!node) return null;
  const trimmed = node.text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pathText(node: XmlNode | undefined, ...path: string[]): string | null {
  let curr: XmlNode | undefined = node;
  for (const seg of path) {
    curr = child(curr, seg);
    if (!curr) return null;
  }
  return textOf(curr);
}

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

function parseIsoDateOnly(node: XmlNode | undefined): string | null {
  const dt = pathText(node, 'Dt') ?? pathText(node, 'DtTm');
  if (!dt) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(dt);
  return match ? match[1] : null;
}

function isBookedStatus(entry: XmlNode): boolean {
  const stsNode = child(entry, 'Sts');
  if (!stsNode) return true;
  const code = textOf(stsNode) ?? pathText(stsNode, 'Cd');
  return !code || code.toUpperCase() === 'BOOK';
}

function extractBankRef(
  entry: XmlNode,
  txDtls: XmlNode | undefined,
  isCredit: boolean,
  bookingDate: string,
  amount: string,
  currency: string,
  entryIndex: number,
): string {
  const ref =
    textOf(child(entry, 'AcctSvcrRef')) ??
    pathText(txDtls, 'Refs', 'AcctSvcrRef') ??
    pathText(txDtls, 'Refs', 'TxId') ??
    textOf(child(entry, 'NtryRef'));
  if (ref) return ref;
  if (isCredit) {
    throw new BadRequestException(
      `Credit entry #${entryIndex + 1} (${bookingDate}, ${amount} ${currency}) is missing a stable bank transaction reference (AcctSvcrRef, TxId, or NtryRef).`,
    );
  }
  return `DBIT-${bookingDate}-${amount}-${currency}-${entryIndex}`;
}

function extractRemitterName(txDtls: XmlNode | undefined): string | null {
  return (
    pathText(txDtls, 'RltdPties', 'Dbtr', 'Nm') ??
    pathText(txDtls, 'RltdPties', 'Dbtr', 'Pty', 'Nm') ??
    pathText(txDtls, 'RltdPties', 'UltmtDbtr', 'Nm') ??
    pathText(txDtls, 'RltdPties', 'UltmtDbtr', 'Pty', 'Nm')
  );
}

function extractRemitterIban(txDtls: XmlNode | undefined): string | null {
  const raw = pathText(txDtls, 'RltdPties', 'DbtrAcct', 'Id', 'IBAN');
  return raw ? normalizeIban(raw) : null;
}

function extractReferenceText(
  entry: XmlNode,
  txDtls: XmlNode | undefined,
): string | null {
  const rmtInf = child(txDtls, 'RmtInf');
  const ustrd = children(rmtInf, 'Ustrd')
    .map((n) => textOf(n))
    .filter((v): v is string => v !== null);
  const strdRef = pathText(rmtInf, 'Strd', 'CdtrRefInf', 'Ref');
  const parts = [...ustrd, ...(strdRef ? [strdRef] : [])];
  if (parts.length > 0) return parts.join(' ');
  return (
    textOf(child(txDtls, 'AddtlTxInf')) ?? textOf(child(entry, 'AddtlNtryInf'))
  );
}

function parseEntry(
  entry: XmlNode,
  entryIndex: number,
): ParsedCamt053Entry | null {
  if (!isBookedStatus(entry)) {
    return null;
  }

  const cdtDbt = textOf(child(entry, 'CdtDbtInd'))?.toUpperCase();
  if (cdtDbt !== 'CRDT' && cdtDbt !== 'DBIT') {
    throw new BadRequestException(
      `Entry #${entryIndex + 1} has invalid or missing CdtDbtInd.`,
    );
  }
  const isCredit = cdtDbt === 'CRDT';

  const amtNode = child(entry, 'Amt');
  const rawAmt = textOf(amtNode);
  const currency = amtNode?.attrs.Ccy?.trim().toUpperCase();
  if (!rawAmt || !/^\d+(?:\.\d+)?$/.test(rawAmt) || !currency) {
    throw new BadRequestException(
      `Entry #${entryIndex + 1} has invalid or missing Amt/Ccy.`,
    );
  }
  const amount = Number.parseFloat(rawAmt).toFixed(2);

  const bookingDate = parseIsoDateOnly(child(entry, 'BookgDt'));
  if (!bookingDate) {
    throw new BadRequestException(
      `Entry #${entryIndex + 1} is missing BookgDt.`,
    );
  }
  const valueDate = parseIsoDateOnly(child(entry, 'ValDt'));

  const txDtls = child(child(entry, 'NtryDtls'), 'TxDtls');
  const bankRef = extractBankRef(
    entry,
    txDtls,
    isCredit,
    bookingDate,
    amount,
    currency,
    entryIndex,
  );

  return {
    isCredit,
    amount,
    currency,
    nonEur: isCredit && currency !== 'EUR',
    bookingDate,
    valueDate,
    bankRef,
    remitterName: extractRemitterName(txDtls),
    remitterIban: extractRemitterIban(txDtls),
    referenceText: extractReferenceText(entry, txDtls),
  };
}

export function parseCamt053(xmlInput: string | Buffer): ParsedCamt053File {
  const xml =
    typeof xmlInput === 'string' ? xmlInput : xmlInput.toString('utf8');
  const doc = parseXmlDocument(xml);
  if (doc.name !== 'Document') {
    throw new BadRequestException(
      'Invalid camt.053 XML: expected <Document> root element.',
    );
  }
  const xmlns = doc.attrs.xmlns ?? '';
  if (xmlns && !xmlns.includes('camt.053')) {
    throw new BadRequestException(
      `Unsupported XML namespace "${xmlns}". Expected camt.053.`,
    );
  }
  const bkToCstmrStmt = child(doc, 'BkToCstmrStmt');
  if (!bkToCstmrStmt) {
    throw new BadRequestException(
      'Invalid camt.053 XML: missing <BkToCstmrStmt>.',
    );
  }
  const stmtNodes = children(bkToCstmrStmt, 'Stmt');
  if (stmtNodes.length === 0) {
    throw new BadRequestException(
      'Invalid camt.053 XML: no <Stmt> elements found.',
    );
  }

  const statements: ParsedCamt053Statement[] = stmtNodes.map((stmt, idx) => {
    const rawIban = pathText(stmt, 'Acct', 'Id', 'IBAN');
    if (!rawIban) {
      throw new BadRequestException(
        `Statement #${idx + 1} is missing <Acct><Id><IBAN>.`,
      );
    }
    const entries = children(stmt, 'Ntry')
      .map((entry, entryIdx) => parseEntry(entry, entryIdx))
      .filter((e): e is ParsedCamt053Entry => e !== null);

    return {
      statementId: textOf(child(stmt, 'Id')),
      receivingIban: normalizeIban(rawIban),
      entries,
    };
  });

  return { statements };
}
