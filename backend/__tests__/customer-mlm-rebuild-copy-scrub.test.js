/**
 * Customer-MLM-rebuild Phase 12 — Copy-scrub acceptance test.
 *
 * Scans every JSX file under the customer module and asserts that no
 * user-visible string ever contains the word "MLM". The scrub does not
 * touch:
 *   - Comments (`//`, `/* ... *​/`)
 *   - Import paths (`"../services/mlmApi"`)
 *   - Identifiers (`mlmApi`, `MlmDashboardPage`)
 *   - Internal enum / code constants (`MLM_BONUS_CREDIT`, `MLM_DISABLED`)
 *
 * It DOES enforce the customer-facing rule by flagging:
 *   - Text inside JSX content (`>...MLM...<`)
 *   - String props commonly used for labels / titles / placeholders /
 *     toast messages.
 *
 * If you intentionally need the substring "MLM" inside a constant code
 * string (e.g. a ledger type id), include `// allow-mlm-copy` on the
 * same line or in the line above to whitelist it.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CUSTOMER_ROOT = path.resolve(
  __dirname,
  "../../frontend/src/modules/customer",
);

// Paths we walk under the customer module to look for rendered copy.
const SCAN_EXTENSIONS = new Set([".jsx", ".tsx"]);

// Forbid these contexts: any string that ends up visible to the user.
// Each pattern matches the surrounding context, with capture group 1
// being the actual string contents we examine.
const VISIBLE_STRING_PATTERNS = [
  // JSX content between tags: >...something...<
  // Multi-line content allowed via the `s` flag.
  /(?:>)([^<>{][^<>]*?)(?:<)/gs,
  // Common attributes that render to the user.
  /(?:title|label|sub|placeholder|aria-label|alt|description)=\s*"([^"]*)"/g,
  /(?:title|label|sub|placeholder|aria-label|alt|description)=\s*'([^']*)'/g,
  /(?:title|label|sub|placeholder|aria-label|alt|description)=\s*\{`([^`]*)`\}/g,
  // Sonner toasts: toast.error("..."), toast.success(`...`), etc.
  /toast\.\w+\(\s*"([^"]*)"/g,
  /toast\.\w+\(\s*'([^']*)'/g,
  /toast\.\w+\(\s*`([^`]*)`/g,
];

const ALLOW_MARK = "allow-mlm-copy";

function walk(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function stripCommentsAndCode(src) {
  // Remove block comments first, then line comments. This is a best-
  // effort scrub — we only need to avoid false positives from inline
  // JSDoc / annotation comments.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function lineNumberFor(src, idx) {
  return src.slice(0, idx).split("\n").length;
}

function findCopyViolations(filepath) {
  const raw = fs.readFileSync(filepath, "utf8");
  const stripped = stripCommentsAndCode(raw);

  const violations = [];

  for (const pattern of VISIBLE_STRING_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(stripped)) !== null) {
      const captured = m[1] || "";
      if (!/\bMLM\b/.test(captured)) continue;

      // Compute the original line number in the raw source.
      const idxInStripped = m.index;
      // Walk back to find a reasonable proxy line in raw — use line
      // numbers from the stripped buffer; close enough for diagnostics.
      const lineNo = lineNumberFor(stripped, idxInStripped);

      // Allow whitelisted lines: look for the ALLOW_MARK on the same
      // line or the line above in the raw source.
      const rawLines = raw.split("\n");
      const surrounding = `${rawLines[lineNo - 1] || ""} ${rawLines[lineNo - 2] || ""}`;
      if (surrounding.includes(ALLOW_MARK)) continue;

      violations.push({
        file: filepath,
        line: lineNo,
        captured: captured.trim().slice(0, 120),
      });
    }
  }

  return violations;
}

describe("Customer-MLM-rebuild Phase 12 — customer copy scrub", () => {
  if (!fs.existsSync(CUSTOMER_ROOT)) {
    test.skip("customer source tree not present in this environment", () => {});
    return;
  }

  const files = walk(CUSTOMER_ROOT);

  test("walks the customer module", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test("no user-visible string in the customer module contains 'MLM'", () => {
    const allViolations = [];
    for (const file of files) {
      allViolations.push(...findCopyViolations(file));
    }
    if (allViolations.length > 0) {
      const report = allViolations
        .map(
          (v) =>
            `  ${path.relative(CUSTOMER_ROOT, v.file)}:${v.line} — ${JSON.stringify(v.captured)}`,
        )
        .join("\n");
      throw new Error(
        `Found ${allViolations.length} customer-rendered "MLM" leak(s):\n${report}`,
      );
    }
    expect(allViolations).toEqual([]);
  });
});
