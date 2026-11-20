// CSV compatibile con Excel: separatore virgola, campi tra virgolette quando
// servono, righe CRLF e BOM UTF-8 (così Excel legge correttamente accenti ed emoji).

export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return "﻿" + lines.join("\r\n");
}

export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
