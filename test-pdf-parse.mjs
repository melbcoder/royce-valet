/**
 * Quick test script: run against a sample PDF to see what pdf-parse extracts
 * Usage: node test-pdf-parse.mjs path/to/invoice.pdf
 */
import fs from 'fs';
import pdfParse from 'pdf-parse';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node test-pdf-parse.mjs <path-to-pdf>');
  process.exit(1);
}

const buffer = fs.readFileSync(filePath);
const data = await pdfParse(buffer);
const text = data.text || '';

console.log('=== RAW EXTRACTED TEXT ===');
console.log(text);
console.log('=== END RAW TEXT ===\n');

// Test each regex
console.log('--- Regex Tests ---');

const invoiceNumMatch = text.match(/Tax Invoice Number\s+(PG[.\d]+)\s+for Creditor/i);
console.log('Invoice Number match:', invoiceNumMatch ? invoiceNumMatch[1] : 'NO MATCH');

const longDateMatch = text.match(
  /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
);
console.log('Long date match:', longDateMatch ? longDateMatch[0] : 'NO MATCH');

const accountNameMatch = text.match(/Account\s*name:\s*(.+?)(?:\n|BSB|$)/i);
console.log('Account name match:', accountNameMatch ? accountNameMatch[1].trim() : 'NO MATCH');

const footerNameMatch = text.match(/^([A-Z][A-Za-z\s&]+(?:Pty|Ltd|Group|Management|Travel)[^\n]*)/m);
console.log('Footer name match:', footerNameMatch ? footerNameMatch[1].trim() : 'NO MATCH');

// Check for HTL lines
const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
const htlLines = lines.filter(l => l === 'HTL');
console.log(`\nHTL lines found: ${htlLines.length}`);

// Simulate block-based parsing
console.log('\n--- Simulated Block Parsing ---');
let idx = 0;
let recordNum = 0;
while (idx < lines.length) {
  if (lines[idx] !== 'HTL') { idx++; continue; }
  const block = [];
  let j = idx + 1;
  while (j < lines.length && lines[j] !== 'HTL'
    && !/^(SEG|Total for|Page \d|Head Office|Please pay)/i.test(lines[j])) {
    block.push(lines[j]);
    j++;
  }
  idx = j;
  recordNum++;
  const blockText = block.join(' ');

  const clientMatch = blockText.match(/([A-Z]+\/[A-Z]+\s+(?:MR|MRS|MS|MISS|DR|PROF|MX)S?)\b/i);
  const bookingMatch = blockText.match(/\b(B\.\d{7,})\b/);
  const dateMatches = [...blockText.matchAll(/\b(\d{2}\/\d{2}\/\d{2,4})\b/g)].map(m => m[1]);
  const moneyMatches = [...blockText.matchAll(/\b(\d[\d,]*\.\d{2})\b/g)].map(m =>
    parseFloat(m[1].replace(/,/g, ''))
  );

  let reservationTotal = 0, totalCommission = 0;
  if (moneyMatches.length >= 3) {
    reservationTotal = moneyMatches[1];  // Paid (2nd)
    totalCommission = moneyMatches[2];   // Due (3rd)
  } else if (moneyMatches.length === 2) {
    reservationTotal = moneyMatches[0];
    totalCommission = moneyMatches[1];
  }

  console.log(`Record ${recordNum}: guest=${clientMatch?.[1] || 'NONE'} booking=${bookingMatch?.[1] || 'NONE'} dates=[${dateMatches}] money=[${moneyMatches}] => paid=${reservationTotal} due=${totalCommission}`);
}
console.log(`\nTotal records parsed: ${recordNum}`);
