export const truncate = (text: string, max = 50) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
