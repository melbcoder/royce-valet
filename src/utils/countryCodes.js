import rawCodes from "../countryCodes.csv?raw";

const parseCsvLine = (line) => {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
};

const formatCodes = (codeStr) => {
  if (!codeStr) return "";
  return codeStr
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (c.startsWith("+") ? c : `+${c}`))
    .join(", ");
};

export const countryCodes = rawCodes
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((line) => {
    const [name, code, iso] = parseCsvLine(line);
    return {
      name,
      code: formatCodes(code),
      iso,
    };
  })
  .filter((c) => c.name && c.code && c.iso);
