// Client-side CSV download — matches the prototype's csvDownload(), no API needed
// since the dispatcher already has all the data loaded. Semicolon-delimited (Excel's
// German-locale default), UTF-8 BOM so umlauts render correctly on open.
function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(rows: unknown[][], filename: string): void {
  const csv = "﻿" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
