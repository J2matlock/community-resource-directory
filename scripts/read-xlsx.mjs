// Reads data/source/community-resources.xlsx and prints its rows as JSON.
// Used by the Phase 1 import; run with: node scripts/read-xlsx.mjs
import ExcelJS from 'exceljs';

export async function readRows(path = 'data/source/community-resources.xlsx') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const header = ws.getRow(1).values.slice(1).map((h) => String(h ?? '').trim());
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const rec = { _source_row: n };
    header.forEach((h, i) => {
      const v = row.getCell(i + 1).value;
      let text = v == null ? '' : typeof v === 'object'
        ? (v.text ?? v.hyperlink ?? (v.richText ? v.richText.map((r) => r.text).join('') : v.result ?? JSON.stringify(v)))
        : String(v);
      rec[h] = String(text).replace(/\r\n?/g, '\n').trim();
    });
    if (Object.entries(rec).some(([k, v]) => k !== '_source_row' && v)) rows.push(rec);
  });
  return { sheets: wb.worksheets.map((w) => w.name), header, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await readRows(process.argv[2]);
  process.stdout.write(JSON.stringify(out, null, 1));
}
