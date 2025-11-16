// -------------------------------------------------------------
// Constants
// -------------------------------------------------------------
/**
 * NO_RESULT is an empty array returned when a *valid* query matches nothing.
 */
const NO_RESULT = [];

/**
 * MATCH_ALL is a single query object that matches **every** item.
 * The include array contains a wildcard `"*"` – the search functions treat it as “no required term”.
 * The exclude array is empty.
 */
const MATCH_ALL = [{ include: ["*"], exclude: [] }];

// -------------------------------------------------------------
// ParseError – thrown for any malformed query
// -------------------------------------------------------------
/**
 * Error thrown when a search query cannot be parsed.
 * @extends Error
 */
class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParseError';
  }
}

// -------------------------------------------------------------
// 1) Parenthesis validator (classic stack algorithm)
// Returns true if parentheses are properly ordered and balanced.
// -------------------------------------------------------------
/**
 * Validates that parentheses in the query string are balanced.
 *
 * @param {string} query - The query string (already whitespace-normalised).
 * @throws {ParseError} If parentheses are unbalanced.
 * @returns {void}
 */
function isParenthesisValid(query) {
  const stack = [];
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (ch === "(") {
      stack.push(ch);
    } else if (ch === ")") {
      if (stack.length === 0) {
        throw new ParseError("Unbalanced parentheses – extra closing ')'");
      }
      stack.pop();
    }
  }
  if (stack.length !== 0) {
    throw new ParseError("Unbalanced parentheses – missing closing ')'");
  }
}

// -------------------------------------------------------------
// 2) splitTopLevel(q)
// Split by top-level ' or ' (case-insensitive) and commas, ignoring those inside parentheses.
// Returns array of trimmed parts. Input may be any-cased; function lowercases when matching ' or '.
// -------------------------------------------------------------
/**
 * Splits a query into top-level parts separated by `OR` (or comma).
 * Ignores separators inside parentheses.
 *
 * @param {string} rawQ - The raw query string.
 * @returns {string[]} Array of trimmed top-level parts.
 */
function splitTopLevel(rawQ) {
  if (!rawQ) return [];

  const q = rawQ;
  const parts = [];
  let cur = "";
  let depth = 0;

  // Work on the raw string but do case-insensitive detection for ' or '
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];

    if (ch === "(") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }

    // detect " or " (with spaces) only at depth 0 (case-insensitive)
    if (
      depth === 0 &&
      i + 4 <= q.length &&
      q.slice(i, i + 4).toLowerCase() === " or "
    ) {
      parts.push(cur.trim());
      cur = "";
      i += 3; // skip over " or " (the for-loop will i++ again)
      continue;
    }

    // detect comma at depth 0
    if (depth === 0 && ch === ",") {
      parts.push(cur.trim());
      cur = "";
      continue;
    }

    cur += ch;
  }

  if (cur.trim() !== "") parts.push(cur.trim());
  return parts;
}

// -------------------------------------------------------------
// Helper: isAlphaNum(ch) - used for word boundary checks
// -------------------------------------------------------------
/**
 * Checks if a character is alphanumeric (a-z, A-Z, 0-9).
 *
 * @param {string} ch - Single character to test.
 * @returns {boolean} `true` if alphanumeric.
 */
function isAlphaNum(ch) {
  if (!ch) return false;
  return /[a-z0-9]/i.test(ch);
}

// -------------------------------------------------------------
// 3) splitByAndNotLevel0(part)
// Split a single top-level part by level-0 AND and NOT keywords into tokens.
// - Keeps phrases intact (multi-word) and preserves parentheses inside phrases.
// - Only matches 'and' / 'not' as whole words (word boundaries).
// - Returns an array like: ["aaa xxx", "not", "bbb", "and", "ccc"]
// -------------------------------------------------------------
/**
 * Tokenizes a top-level query part by `AND` and `NOT` at root level only.
 * Respects word boundaries and preserves phrases and parentheses.
 *
 * @param {string} rawPart - A single top-level query segment.
 * @returns {string[]} Array of tokens (phrases or operators).
 */
function splitByAndNotLevel0(rawPart) {
  if (!rawPart) return [];

  const q = rawPart;
  const tokens = [];
  let cur = "";
  let depth = 0;
  let i = 0;
  const len = q.length;

  function startsWithWordAt(pos, word) {
    const lowerSlice = q.slice(pos, pos + word.length).toLowerCase();
    if (lowerSlice !== word) return false;
    const before = pos - 1 >= 0 ? q[pos - 1] : null;
    const after = pos + word.length < len ? q[pos + word.length] : null;

    // boundary: before must not be alnum, after must not be alnum
    if (before && isAlphaNum(before)) return false;
    if (after && isAlphaNum(after)) return false;
    return true;
  }

  while (i < len) {
    const ch = q[i];

    if (ch === "(") {
      depth++;
      cur += ch;
      i++;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
      i++;
      continue;
    }

    // Only at depth 0 do we detect `and` or `not` as separators
    if (depth === 0) {
      if (startsWithWordAt(i, "and")) {
        if (cur.trim() !== "") {
          tokens.push(cur.trim());
          cur = "";
        }
        tokens.push("and");
        i += 3;
        continue;
      }
      if (startsWithWordAt(i, "not")) {
        if (cur.trim() !== "") {
          tokens.push(cur.trim());
          cur = "";
        }
        tokens.push("not");
        i += 3;
        continue;
      }
    }

    // Otherwise just append the character to current phrase
    cur += ch;
    i++;
  }

  if (cur.trim() !== "") tokens.push(cur.trim());
  return tokens.filter(Boolean);
}

// -------------------------------------------------------------
// Helper: splitByAndTopLevelInsideParenthesis(s)
// Splits the string s (without outer parentheses) by top-level ' and ' tokens.
// This ignores nesting; since nested parenthesis are invalid in your rules, we assume none.
// Returns array of chunk strings (trimmed).
// -------------------------------------------------------------
/**
 * Splits content inside parentheses by top-level `AND`.
 * Used when `(A OR B) AND (C OR D)` needs to expand into combinations.
 *
 * @param {string} s - Inner string (without outer parentheses).
 * @returns {string[]} Array of chunks separated by top-level `AND`.
 */
function splitByAndTopLevelInsideParenthesis(s) {
  if (!s) return [];
  const parts = [];
  let cur = "";
  // We consider top-level only; nested parentheses disallowed/invalid per rules.
  // But still track depth to be defensive.
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    // detect " and " at depth 0
    if (
      depth === 0 &&
      i + 5 <= s.length &&
      s.slice(i, i + 5).toLowerCase() === " and "
    ) {
      parts.push(cur.trim());
      cur = "";
      i += 4;
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur.trim());
  return parts;
}

// -------------------------------------------------------------
// Helper: extractAllTermsFromParenthesis(s)
// Given string like "(a OR b AND c, d)" -> returns array of all terms inside
// splitting by top-level OR, AND and commas. Do not attempt boolean logic.
// Used for NOT(parenthesis) -> add all inner terms to exclude.
// -------------------------------------------------------------
/**
 * Extracts all atomic terms from inside a parenthesized group.
 * Used primarily for `NOT (A OR B)` to exclude all variants.
 *
 * @param {string} s - Full parenthesized string, e.g., `(a OR b, c)`.
 * @returns {string[]} Array of individual terms.
 */
function extractAllTermsFromParenthesis(s) {
  if (!s) return [];
  // remove outer parentheses if present
  let inner = s.trim();
  if (inner.startsWith("(") && inner.endsWith(")")) {
    inner = inner.slice(1, -1);
  }
  // Now split by top-level OR/commas and top-level AND
  // We can reuse splitTopLevel to split by OR/comma at top-level,
  // but we also want to split by ANDs that are top-level.
  // Easiest: scan and split when we see top-level separators.
  const terms = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }

    // top-level " or "
    if (depth === 0 && i + 4 <= inner.length && inner.slice(i, i + 4).toLowerCase() === " or ") {
      if (cur.trim() !== "") terms.push(cur.trim());
      cur = "";
      i += 3;
      continue;
    }

    // top-level comma
    if (depth === 0 && ch === ",") {
      if (cur.trim() !== "") terms.push(cur.trim());
      cur = "";
      continue;
    }

    // top-level " and "
    if (depth === 0 && i + 5 <= inner.length && inner.slice(i, i + 5).toLowerCase() === " and ") {
      if (cur.trim() !== "") terms.push(cur.trim());
      cur = "";
      i += 4;
      continue;
    }

    cur += ch;
  }
  if (cur.trim() !== "") terms.push(cur.trim());

  // Now terms[] may still contain parentheses; remove outer parens if any (single-level only)
  return terms.map((t) => {
    let tt = t.trim();
    if (tt.startsWith("(") && tt.endsWith(")")) tt = tt.slice(1, -1).trim();
    return tt;
  }).filter(Boolean);
}

// -------------------------------------------------------------
// 4) parseQuery(query)
// Main function that:
// - Validates parentheses (returns NO_RESULT if invalid).
// - Splits top-level OR/comma into parts.
// - For each part, tokenizes by AND/NOT (level 0) and builds one or more {include:[], exclude:[]} objects
// - Returns an array of query objects [{include:[],exclude:[]}, ...] or NO_RESULT
// -------------------------------------------------------------
/**
 * Parses a search query into structured include/exclude rules.
 * Supports: OR (comma), AND, NOT, parentheses (no nesting), phrases.
 *
 * @param {string} rawQuery - The raw search query.
 * @returns {Array<{include: string[], exclude: string[]}>} Array of query objects.
 *          Returns `MATCH_ALL` if the query is empty/whitespace.
 *          Returns `NO_RESULT` (`[]`) when a *valid* query matches nothing.
 * @throws {ParseError} If the query syntax is invalid (unbalanced parens,
 *                      nested parens, stray operators, etc.).
 */
function parseQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== "string") return MATCH_ALL;

  // Query preprocessing
  let query = rawQuery
    .trim()                                 // initial trim
    .replace(/\s+/g, " ")                   // collapse spaces
    .replace(/ AND NOT /gi, " NOT ")        // semantic rule: "AND NOT" == "NOT"
    .trim();                                // final trim

  // Quick parentheses validation
  isParenthesisValid(query); // throws ParseError if unbalanced

  // Split top-level by OR/commas (these produce separate query objects)
  const topParts = splitTopLevel(query);

  const queries = [];

  for (const part of topParts) {
    // For each top-level part, split by level-0 AND/NOT into tokens
    const tokens = splitByAndNotLevel0(part);

    if (tokens.length === 0) {
      // skip empty parts
      continue;
    }

    // We'll build partial query objects and expand them when parentheses-with-AND require multiple groups.
    // Start with a single partial
    let partials = [{ include: [], exclude: [] }];

    // Determine first token -> initial include (defensive: skip leading operators)
    let idx = 0;
    // find first phrase
    while (idx < tokens.length && (tokens[idx].toLowerCase() === "and" || tokens[idx].toLowerCase() === "not")) {
      // if there is a leading NOT - handle it: a leading NOT means exclude for all partials
      if (tokens[idx].toLowerCase() === "not") {
        const next = tokens[idx + 1];
        if (next) {
          // if next is parenthesis, extract all inner terms
          if (next.trim().startsWith("(") && next.trim().endsWith(")")) {
            const allTerms = extractAllTermsFromParenthesis(next);
            for (const p of partials) {
              p.exclude.push(...allTerms);
            }
          } else {
            for (const p of partials) {
              p.exclude.push(next);
            }
          }
          idx += 2;
          continue;
        } else {
          // stray NOT -> skip
          idx++;
          continue;
        }
      }
      // stray AND - skip
      idx++;
    }

    if (idx < tokens.length && tokens[idx].toLowerCase() !== "and" && tokens[idx].toLowerCase() !== "not") {
      // First phrase becomes include for all partials
      const firstPhrase = tokens[idx];
      for (const p of partials) p.include.push(firstPhrase);
      idx++;
    }

    // Process the rest tokens left-to-right
    while (idx < tokens.length) {
      const op = tokens[idx] ? tokens[idx].toLowerCase() : null;

      if (op === "and") {
        const next = tokens[idx + 1];
        if (!next) {
          // stray and => ignore
          idx++;
          continue;
        }

        // If next is a parenthesis group
        const nt = next.trim();
        if (nt.startsWith("(") && nt.endsWith(")")) {
          // Remove outer parentheses
          const inner = nt.slice(1, -1).trim();

          // Nested parenthesis check: if inner contains '(' or ')' it's nested -> invalid per your rule
          if (inner.includes("(") || inner.includes(")")) {
            throw new ParseError("Nested parentheses are not allowed");
          }

          // Special rule: parentheses after AND are processed by splitting by top-level AND inside the parentheses
          // then splitting each chunk by top-level OR to produce chunkChoices,
          // then build Cartesian product across those chunks and expand partials accordingly.

          // Step 1: split inner by top-level AND into chunks
          const chunks = splitByAndTopLevelInsideParenthesis(inner); // returns array like ["ccc OR ddd", "eee OR fff"]

          // Step 2: for each chunk, get choices by splitting by top-level OR/comma
          const chunkChoices = chunks.map((c) => {
            const choices = splitTopLevel(c); // splitTopLevel handles OR / comma
            // trim parentheses if any (shouldn't be)
            return choices.map((ch) => ch.trim());
          });

          // Now expand partials by Cartesian product across chunkChoices
          // For each chunk in sequence, create new partials
          let newPartials = partials;
          for (const choices of chunkChoices) {
            const temp = [];
            for (const p of newPartials) {
              for (const choice of choices) {
                // clone p
                const clone = {
                  include: p.include.slice(),
                  exclude: p.exclude.slice()
                };
                // add choice to include
                clone.include.push(choice);
                temp.push(clone);
              }
            }
            newPartials = temp;
          }

          partials = newPartials;
          idx += 2; // consumed 'and' and the parenthesis token
          continue;
        } else {
          // next is a normal phrase (no parentheses)
          for (const p of partials) {
            p.include.push(next);
          }
          idx += 2;
          continue;
        }
      } else if (op === "not") {
        const next = tokens[idx + 1];
        if (!next) {
          idx++;
          continue;
        }

        // If next is parenthesis -> extract all inner terms and add to exclude for all partials
        const nt = next.trim();
        if (nt.startsWith("(") && nt.endsWith(")")) {
          const inner = nt.slice(1, -1).trim();
          // reject nested parentheses inside -> invalid
          if (inner.includes("(") || inner.includes(")")) {
            throw new ParseError("Nested parentheses are not allowed");
          }
          const allTerms = extractAllTermsFromParenthesis(nt);
          for (const p of partials) {
            p.exclude.push(...allTerms);
          }
          idx += 2;
          continue;
        } else {
          // simple phrase
          for (const p of partials) {
            p.exclude.push(next);
          }
          idx += 2;
          continue;
        }
      } else {
        // unexpected token (a phrase without an explicit operator)
        // treat as additional include (defensive)
        for (const p of partials) {
          p.include.push(tokens[idx]);
        }
        idx++;
        continue;
      }
    } // end while tokens

    // push all partials into final queries
    for (const p of partials) {
      queries.push({
        include: p.include,
        exclude: p.exclude
      });
    }
  } // end for topParts

  return queries.length === 0 ? NO_RESULT : queries;
}

// -------------------------------------------------------------
// 5) Search Functions
// -------------------------------------------------------------

/**
 * Filters an array of strings based on a search query.
 *
 * @param {string} query - The search query.
 * @param {string[]} items - Array of strings to filter.
 * @returns {string[]} Filtered array – `[]` means **no match**, never an error.
 * @throws {ParseError} If the query syntax is invalid.
 */
function searchStrings(query, items) {
  // empty data
  if (!Array.isArray(items)) return NO_RESULT;

  // parse
  const parsed = parseQuery(query);

  // filter
  return items.filter(item => {
    const lower = item.toLowerCase();

    return parsed.some(rule => {
      // include
      const includeOk =
        rule.include.length === 0 ||
        rule.include[0] === "*" ||
        rule.include.every(inc => lower.includes(inc.toLowerCase()));

      // exclude
      const excludeOk = !rule.exclude.some(exc => lower.includes(exc.toLowerCase()));

      return includeOk && excludeOk;
    });
  });
}

/**
 * Filters an array of objects by searching within a specific key.
 *
 * @param {string} query - The search query.
 * @param {Object[]} items - Array of objects to filter.
 * @param {string} key - The object key to search within.
 * @returns {Object[]} Filtered array – `[]` means **no match**.
 * @throws {ParseError} If the query syntax is invalid.
 */
function searchObjects(query, items, key) {
  // empty data or invalid key
  if (!Array.isArray(items) || typeof key !== "string") return NO_RESULT;

  // parse
  const parsed = parseQuery(query);

  // filter
  return items.filter(item => {
    const value = item[key];
    if (typeof value !== "string") return false;
    const lower = value.toLowerCase();

    return parsed.some(rule => {
      // include
      const includeOk =
        rule.include.length === 0 ||
        rule.include[0] === "*" ||
        rule.include.every(inc => lower.includes(inc.toLowerCase()));

      // exclude
      const excludeOk = !rule.exclude.some(exc => lower.includes(exc.toLowerCase()));

      return includeOk && excludeOk;
    });
  });
}

// -------------------------------------------------------------
// Export
// -------------------------------------------------------------
export { 
  parseQuery, 
  searchStrings, 
  searchObjects,
  ParseError
};