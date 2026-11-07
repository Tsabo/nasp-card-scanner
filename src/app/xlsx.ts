/**
 * @file Writes a simple Excel workbook (.xlsx) with no outside libraries.
 *
 * An .xlsx file is a zip archive of XML files. This writes the fewest files
 * Excel and Google Sheets need, with plain cells and no formatting. The zip
 * entries are stored uncompressed, which the format allows and keeps this short.
 */

/** A cell. Text stays text, numbers are real numbers, and "" leaves the cell empty. */
export type XlsxCell = string | number;

/** One sheet: a heading row, then the data rows. */
export interface XlsxSheet {
  name: string;
  headings: readonly string[];
  rows: ReadonlyArray<readonly XlsxCell[]>;
}

const SPREADSHEET_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Builds the workbook, with the sheets in the order given. */
export function createXlsx(sheets: readonly XlsxSheet[]): Uint8Array<ArrayBuffer> {
  const sheetNumbers = sheets.map((_, sheetIndex) => sheetIndex + 1);
  return createZip([
    { path: "[Content_Types].xml", text: createContentTypes(sheetNumbers) },
    { path: "_rels/.rels", text: createPackageRelationships() },
    { path: "xl/workbook.xml", text: createWorkbook(sheets) },
    { path: "xl/_rels/workbook.xml.rels", text: createWorkbookRelationships(sheetNumbers) },
    ...sheets.map((sheet, sheetIndex) => ({
      path: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      text: createWorksheet(sheet),
    })),
  ]);
}

function createContentTypes(sheetNumbers: readonly number[]): string {
  const sheetOverrides = sheetNumbers.map(
    (number) =>
      `<Override PartName="/xl/worksheets/sheet${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  );
  return (
    `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    `${sheetOverrides.join("")}</Types>`
  );
}

function createPackageRelationships(): string {
  return (
    `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">` +
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/>` +
    "</Relationships>"
  );
}

function createWorkbook(sheets: readonly XlsxSheet[]): string {
  const sheetEntries = sheets.map(
    (sheet, sheetIndex) =>
      `<sheet name="${escapeXml(sheet.name)}" sheetId="${sheetIndex + 1}" r:id="rId${sheetIndex + 1}"/>`,
  );
  return (
    `${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIPS}">` +
    `<sheets>${sheetEntries.join("")}</sheets></workbook>`
  );
}

function createWorkbookRelationships(sheetNumbers: readonly number[]): string {
  const relationships = sheetNumbers.map(
    (number) =>
      `<Relationship Id="rId${number}" Type="${OFFICE_RELATIONSHIPS}/worksheet" Target="worksheets/sheet${number}.xml"/>`,
  );
  return `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">${relationships.join("")}</Relationships>`;
}

function createWorksheet(sheet: XlsxSheet): string {
  const rows = [sheet.headings, ...sheet.rows].map((cells, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cellXml = cells.map((cell, columnIndex) =>
      createCell(`${getColumnLetters(columnIndex)}${rowNumber}`, cell),
    );
    return `<row r="${rowNumber}">${cellXml.join("")}</row>`;
  });
  return `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NAMESPACE}"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function createCell(reference: string, cell: XlsxCell): string {
  if (typeof cell === "number") {
    return `<c r="${reference}"><v>${cell}</v></c>`;
  }
  if (cell === "") {
    return "";
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
}

/** Converts a column position to its letters: 0 is A, 25 is Z, 26 is AA. */
function getColumnLetters(columnIndex: number): string {
  let letters = "";
  let remaining = columnIndex + 1;
  while (remaining > 0) {
    const letterIndex = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + letterIndex) + letters;
    remaining = (remaining - 1 - letterIndex) / 26;
  }
  return letters;
}

/** Escapes text for XML and removes the control characters XML can't hold. */
function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Zip archive
// ---------------------------------------------------------------------------

/** One file to put in the archive. */
interface ZipEntry {
  path: string;
  text: string;
}

/** The zip format's version number for these entries: 2.0. */
const ZIP_VERSION = 20;
/** January 1, 1980, the earliest date a zip entry can hold. */
const ZIP_DATE = 0x0021;

/** Builds a zip archive with the entries stored uncompressed. */
function createZip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const contents = encoder.encode(entry.text);
    const checksum = getCrc32(contents);

    const localHeader = new ByteWriter(30);
    localHeader.u32(0x04034b50);
    localHeader.u16(ZIP_VERSION);
    localHeader.u16(0); // Flags
    localHeader.u16(0); // Method: stored
    localHeader.u16(0); // Time
    localHeader.u16(ZIP_DATE);
    localHeader.u32(checksum);
    localHeader.u32(contents.length); // Compressed size
    localHeader.u32(contents.length); // Uncompressed size
    localHeader.u16(name.length);
    localHeader.u16(0); // Extra field length
    localParts.push(localHeader.bytes, name, contents);

    const centralHeader = new ByteWriter(46);
    centralHeader.u32(0x02014b50);
    centralHeader.u16(ZIP_VERSION); // Version made by
    centralHeader.u16(ZIP_VERSION); // Version needed
    centralHeader.u16(0); // Flags
    centralHeader.u16(0); // Method: stored
    centralHeader.u16(0); // Time
    centralHeader.u16(ZIP_DATE);
    centralHeader.u32(checksum);
    centralHeader.u32(contents.length); // Compressed size
    centralHeader.u32(contents.length); // Uncompressed size
    centralHeader.u16(name.length);
    centralHeader.u16(0); // Extra field length
    centralHeader.u16(0); // Comment length
    centralHeader.u16(0); // Disk number
    centralHeader.u16(0); // Internal attributes
    centralHeader.u32(0); // External attributes
    centralHeader.u32(offset);
    centralParts.push(centralHeader.bytes, name);

    offset += localHeader.bytes.length + name.length + contents.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const endRecord = new ByteWriter(22);
  endRecord.u32(0x06054b50);
  endRecord.u16(0); // This disk
  endRecord.u16(0); // Disk holding the directory
  endRecord.u16(entries.length); // Entries on this disk
  endRecord.u16(entries.length); // Entries in total
  endRecord.u32(centralSize);
  endRecord.u32(offset);
  endRecord.u16(0); // Comment length

  const parts = [...localParts, ...centralParts, endRecord.bytes];
  const archive = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let position = 0;
  for (const part of parts) {
    archive.set(part, position);
    position += part.length;
  }
  return archive;
}

/** Writes little-endian numbers into a fixed-size block, as zip headers need. */
class ByteWriter {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private position = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number): void {
    this.view.setUint16(this.position, value, true);
    this.position += 2;
  }

  u32(value: number): void {
    this.view.setUint32(this.position, value, true);
    this.position += 4;
  }
}

/** The lookup table for the CRC-32 checksum zip files use. */
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, tableIndex) => {
  let value = tableIndex;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value;
});

/** Calculates the CRC-32 checksum of some bytes. */
function getCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
