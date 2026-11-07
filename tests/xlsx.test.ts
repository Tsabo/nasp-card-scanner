import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32 } from "node:zlib";

import { createXlsx } from "../src/app/xlsx.ts";

/**
 * Reads a zip archive through its central directory, the way spreadsheet apps
 * do, checking each entry's checksum.
 */
function readZip(archive: Uint8Array): Map<string, string> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const endRecord = archive.length - 22;
  assert.equal(view.getUint32(endRecord, true), 0x06054b50);
  const entryCount = view.getUint16(endRecord + 10, true);

  const files = new Map<string, string>();
  let position = view.getUint32(endRecord + 16, true);
  for (let entry = 0; entry < entryCount; entry++) {
    assert.equal(view.getUint32(position, true), 0x02014b50);
    const checksum = view.getUint32(position + 16, true);
    const size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const localOffset = view.getUint32(position + 42, true);
    const name = decoder.decode(archive.subarray(position + 46, position + 46 + nameLength));

    assert.equal(view.getUint32(localOffset, true), 0x04034b50);
    const contentsStart = localOffset + 30 + view.getUint16(localOffset + 26, true);
    const contents = archive.subarray(contentsStart, contentsStart + size);
    assert.equal(crc32(contents), checksum, `checksum of ${name}`);
    files.set(name, decoder.decode(contents));
    position += 46 + nameLength;
  }
  return files;
}

describe("createXlsx", () => {
  it("writes each sheet with its name, in order", () => {
    const files = readZip(
      createXlsx([
        { name: "Bullseye", headings: ["Date"], rows: [] },
        { name: "3D", headings: ["Date"], rows: [] },
      ]),
    );
    const workbook = files.get("xl/workbook.xml") ?? "";
    assert.ok(workbook.indexOf('name="Bullseye"') < workbook.indexOf('name="3D"'));
    assert.ok(files.has("xl/worksheets/sheet1.xml"));
    assert.ok(files.has("xl/worksheets/sheet2.xml"));
    assert.ok(files.get("[Content_Types].xml")?.includes("/xl/worksheets/sheet2.xml"));
  });

  it("keeps a sheet with only headings", () => {
    const files = readZip(createXlsx([{ name: "3D", headings: ["Date"], rows: [] }]));
    assert.ok(files.get("xl/worksheets/sheet1.xml")?.includes(">Date</t>"));
  });

  it("writes numbers as numbers, text as text, and leaves blanks empty", () => {
    const sheet = readZip(
      createXlsx([{ name: "Log", headings: ["A", "B", "C"], rows: [["01234", 10, ""]] }]),
    ).get("xl/worksheets/sheet1.xml");
    assert.ok(sheet?.includes('<c r="A2" t="inlineStr"><is><t xml:space="preserve">01234</t>'));
    assert.ok(sheet?.includes('<c r="B2"><v>10</v></c>'));
    assert.ok(!sheet?.includes('r="C2"'));
  });

  it("escapes XML and removes characters XML can't hold", () => {
    const sheet = readZip(
      createXlsx([{ name: "Log", headings: ["Name"], rows: [['R&B <"Jr">\u0007']] }]),
    ).get("xl/worksheets/sheet1.xml");
    assert.ok(sheet?.includes(">R&amp;B &lt;&quot;Jr&quot;&gt;</t>"));
  });

  it("names columns past Z", () => {
    const headings = Array.from({ length: 53 }, (_, index) => `Column ${index}`);
    const sheet = readZip(createXlsx([{ name: "Log", headings, rows: [] }])).get(
      "xl/worksheets/sheet1.xml",
    );
    assert.ok(sheet?.includes('r="Z1"'));
    assert.ok(sheet?.includes('r="AA1"'));
    assert.ok(sheet?.includes('r="AZ1"'));
    assert.ok(sheet?.includes('r="BA1"'));
  });
});
