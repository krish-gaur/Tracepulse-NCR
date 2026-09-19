/* Minimal safe markdown → HTML for copilot messages (bold, code, lists, headings) */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function md(src: string): string {
  const lines = escapeHtml(src).split("\n");
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*] /.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + inline(line.replace(/^\s*[-*] /, "")) + "</li>");
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (/^#{1,3} /.test(line)) {
      const lvl = line.match(/^#+/)![0].length;
      out.push(`<h${Math.min(lvl + 3, 6)}>${inline(line.replace(/^#+\s*/, ""))}</h${Math.min(lvl + 3, 6)}>`);
    } else if (line.startsWith("&gt; ")) {
      out.push(`<blockquote>${inline(line.slice(5))}</blockquote>`);
    } else if (line.trim() === "") {
      out.push("");
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
