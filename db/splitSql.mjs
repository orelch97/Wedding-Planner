/* =============================================================================
 *  splitSql.mjs — פיצול קובץ SQL להצהרות בודדות
 * -----------------------------------------------------------------------------
 *  CockroachDB לא מריץ כמה הצהרות DDL בטרנזקציה אחת בצורה אטומית, ולכן מריצים
 *  אותן אחת-אחת. פיצול נאיבי על ';' היה שובר גופי פונקציה של $$ ... $$.
 * ========================================================================== */

export function splitSql(text) {
  const statements = [];
  let current = "";
  let i = 0;
  let dollarTag = null; // ה-tag הפתוח של $$ / $tag$, אם יש

  while (i < text.length) {
    const ch = text[i];

    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += ch;
      i++;
      continue;
    }

    // הערת שורה
    if (ch === "-" && text[i + 1] === "-") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end + 1;
      continue;
    }

    // הערת בלוק
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }

    // מחרוזת רגילה
    if (ch === "'") {
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") i += 2;
        else if (text[i] === "'") { i++; break; }
        else i++;
      }
      current += text.slice(start, i);
      continue;
    }

    // מזהה במרכאות כפולות
    if (ch === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') i++;
      i++;
      current += text.slice(start, i);
      continue;
    }

    // פתיחת גוף $$ / $tag$
    if (ch === "$") {
      const match = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
