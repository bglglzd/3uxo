/// Экспорт в Word (.docx) без зависимостей: Markdown → WordprocessingML,
/// упакованный в ZIP (без сжатия — Word/LibreOffice/Pages открывают такие
/// файлы штатно). Поддержано то, что реально бывает в отчётах Auris:
/// заголовки, абзацы, списки (в т.ч. чек-листы), таблицы, **жирный**,
/// *курсив*, `код`, горизонтальная черта.

// ---------- ZIP (store) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/// Собирает ZIP-архив без сжатия из пар «имя → содержимое».
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // имена в UTF-8
    lv.setUint16(8, 0, true); // store
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, f.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// ---------- Markdown → WordprocessingML ----------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Управляющие символы недопустимы в XML.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/// Инлайн-разметка → последовательность run'ов.
export function inlineRuns(text: string): string {
  const runs: string[] = [];
  // **жирный**, __жирный__, *курсив*, _курсив_, `код`, [текст](ссылка)
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]*\))/g;
  let last = 0;
  const run = (t: string, props = "") => {
    if (!t) return;
    runs.push(
      `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`,
    );
  };
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    run(text.slice(last, i));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) run(tok.slice(2, -2), "<w:b/>");
    else if (tok.startsWith("`")) run(tok.slice(1, -1), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
    else if (tok.startsWith("[")) run(tok.slice(1, tok.indexOf("]")));
    else run(tok.slice(1, -1), "<w:i/>");
    last = i + tok.length;
  }
  run(text.slice(last));
  return runs.join("");
}

function para(text: string, style?: string, extra = ""): string {
  const ppr = style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : "";
  return `<w:p>${ppr}${inlineRuns(text)}</w:p>`;
}

function cells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|")) r = r.slice(0, -1);
  return r.split("|").map((c) => c.trim());
}

function table(rows: string[][]): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const border = '<w:top w:val="single" w:sz="4" w:color="BFC7D5"/><w:left w:val="single" w:sz="4" w:color="BFC7D5"/><w:bottom w:val="single" w:sz="4" w:color="BFC7D5"/><w:right w:val="single" w:sz="4" w:color="BFC7D5"/><w:insideH w:val="single" w:sz="4" w:color="BFC7D5"/><w:insideV w:val="single" w:sz="4" w:color="BFC7D5"/>';
  const body = rows
    .map(
      (r, ri) =>
        `<w:tr>${Array.from({ length: cols }, (_, ci) => {
          const t = r[ci] ?? "";
          const shade = ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F8"/>' : "";
          const txt = ri === 0 ? `**${t.replace(/\*\*/g, "")}**` : t;
          return `<w:tc><w:tcPr>${shade}</w:tcPr>${para(txt)}</w:tc>`;
        }).join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${body}</w:tbl>${para("")}`;
}

/// Тело документа из Markdown.
export function markdownToBody(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let paraBuf: string[] = [];
  const flush = () => {
    if (paraBuf.length) {
      out.push(para(paraBuf.join(" ")));
      paraBuf = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      flush();
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flush();
      const lvl = Math.min(3, h[1].length);
      out.push(para(h[2].replace(/#+\s*$/, ""), `Heading${lvl}`));
      i++;
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(t)) {
      flush();
      out.push(
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFC7D5"/></w:pBdr></w:pPr></w:p>',
      );
      i++;
      continue;
    }
    if (t.startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const rows: string[][] = [cells(t)];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(cells(lines[i]));
        i++;
      }
      out.push(table(rows));
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/.exec(line);
    if (li) {
      flush();
      const depth = Math.min(3, Math.floor(li[1].replace(/\t/g, "  ").length / 2));
      const numbered = /\d/.test(li[2]);
      const mark = li[3] ? (li[4] === " " ? "☐ " : "☑ ") : numbered ? `${li[2]} ` : "• ";
      const ind = 360 + depth * 360;
      out.push(
        para(mark + li[5], undefined, `<w:ind w:left="${ind}" w:hanging="280"/><w:spacing w:after="60"/>`),
      );
      i++;
      continue;
    }
    const q = /^>\s?(.*)$/.exec(t);
    if (q) {
      flush();
      out.push(para(q[1], "Quote"));
      i++;
      continue;
    }
    paraBuf.push(t);
    i++;
  }
  flush();
  return out.join("");
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="1F3A68"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F3A68"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="2E6FE0"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="6B7385"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;

/// Собирает .docx из Markdown. `title` — заголовок документа (стиль Title).
export function markdownToDocx(md: string, title?: string): Uint8Array {
  const enc = new TextEncoder();
  const body = (title ? para(title, "Title") : "") + markdownToBody(md);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
    },
    {
      name: "word/_rels/document.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: "word/document.xml", data: enc.encode(doc) },
    { name: "word/styles.xml", data: enc.encode(STYLES) },
  ];
  return zipStore(files);
}

/// Байты → base64 (для передачи в бэкенд).
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}
