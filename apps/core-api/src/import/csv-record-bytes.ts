function quotedByte(
  buf: Buffer,
  index: number,
): { index: number; closed: boolean } {
  if (buf[index] !== 0x22) {
    return { index, closed: false };
  }
  if (buf[index + 1] === 0x22) {
    return { index: index + 1, closed: false };
  }
  return { index, closed: true };
}

function lineBreakEnd(buf: Buffer, index: number): number {
  if (buf[index] !== 0x0d) {
    return buf[index] === 0x0a ? index + 1 : -1;
  }
  if (index + 1 >= buf.length) {
    return -2;
  }
  return buf[index + 1] === 0x0a ? index + 2 : index + 1;
}

/** Exclusive end offset of the next CSV record, or -1 when the buffer is incomplete. */
export function csvRecordEnd(buf: Buffer, from: number): number {
  let inQuotes = false;
  for (let index = from; index < buf.length; index += 1) {
    if (inQuotes) {
      const quoted = quotedByte(buf, index);
      index = quoted.index;
      inQuotes = !quoted.closed;
      continue;
    }
    if (buf[index] === 0x22) {
      inQuotes = true;
      continue;
    }
    const end = lineBreakEnd(buf, index);
    if (end === -2) {
      return -1;
    }
    if (end > 0) {
      return end;
    }
  }
  return -1;
}
