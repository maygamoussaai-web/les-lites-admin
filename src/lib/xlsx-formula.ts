/**
 * Évaluateur de formules Excel — minimal mais suffisant pour les bulletins.
 *
 * NOTE POUR CLAUDE :
 * - Utilisé uniquement pour REJOUER les formules déjà écrites dans le modèle
 *   Excel importé par l'utilisateur (src/lib/xlsx-template.ts). Aucune règle
 *   de calcul n'est inventée ici : la source des notes reste src/lib/grades.ts.
 * - Toute fonction non gérée lève `UnsupportedFormulaError` : l'import le
 *   signale à l'utilisateur au lieu d'ignorer la formule en silence.
 */

export class UnsupportedFormulaError extends Error {
  constructor(public fn: string) {
    super(`Fonction non gérée : ${fn}`);
  }
}

export type CellValue = number | string | null;
export type CellGetter = (ref: string) => CellValue;

const colToIndex = (col: string) =>
  col.split("").reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 64), 0);

const indexToCol = (index: number) => {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/** Développe "A1:C3" en liste de références. */
export function expandRange(range: string): string[] {
  const [start, end] = range.split(":");
  if (!start || !end) return [range];
  const m1 = /^\$?([A-Z]+)\$?(\d+)$/.exec(start);
  const m2 = /^\$?([A-Z]+)\$?(\d+)$/.exec(end);
  if (!m1 || !m2) return [range];
  const c1 = colToIndex(m1[1]!);
  const c2 = colToIndex(m2[1]!);
  const r1 = Number(m1[2]);
  const r2 = Number(m2[2]);
  const refs: string[] = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) refs.push(`${indexToCol(c)}${r}`);
  }
  return refs;
}

const num = (v: CellValue): number => {
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  const parsed = Number(String(v).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const numbersOnly = (values: CellValue[]) =>
  values.filter((v) => v !== null && v !== "" && Number.isFinite(Number(String(v).replace(",", ".")))).map(num);

type Token = { type: "num" | "str" | "ref" | "range" | "fn" | "op" | "paren" | "sep"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const src = input.replace(/^=/, "");
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let str = "";
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') {
          str += '"';
          j += 2;
          continue;
        }
        if (src[j] === '"') break;
        str += src[j];
        j++;
      }
      tokens.push({ type: "str", value: str });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(src.slice(i))!;
      tokens.push({ type: "num", value: m[0] });
      i += m[0].length;
      continue;
    }
    const refMatch = /^\$?[A-Z]{1,3}\$?[0-9]{1,7}(:\$?[A-Z]{1,3}\$?[0-9]{1,7})?/.exec(src.slice(i));
    const nameMatch = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*/.exec(src.slice(i));
    if (refMatch && (!nameMatch || refMatch[0].length >= nameMatch[0].length)) {
      const raw = refMatch[0].replace(/\$/g, "");
      tokens.push({ type: raw.includes(":") ? "range" : "ref", value: raw });
      i += refMatch[0].length;
      continue;
    }
    if (nameMatch) {
      const rest = src.slice(i + nameMatch[0].length).trimStart();
      if (rest.startsWith("(")) {
        tokens.push({ type: "fn", value: nameMatch[0].toUpperCase() });
        i += nameMatch[0].length;
        continue;
      }
      // Nom défini / texte non géré
      throw new UnsupportedFormulaError(nameMatch[0]);
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i++;
      continue;
    }
    if (ch === "," || ch === ";") {
      tokens.push({ type: "sep", value: "," });
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/^%&=<>".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    throw new UnsupportedFormulaError(ch);
  }
  return tokens;
}

/** Évalue une formule Excel simple contre une grille de cellules. */
export function evaluateFormula(formula: string, get: CellGetter): CellValue {
  const tokens = tokenize(formula);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];

  // Renvoie une liste de valeurs (pour les plages passées aux fonctions).
  const parseArg = (): CellValue[] => {
    const token = peek();
    if (token?.type === "range" && tokens[pos + 1] && ["sep", "paren"].includes(tokens[pos + 1]!.type)) {
      pos++;
      return expandRange(token.value).map(get);
    }
    if (token?.type === "range" && !tokens[pos + 1]) {
      pos++;
      return expandRange(token.value).map(get);
    }
    return [parseComparison()];
  };

  function parsePrimary(): CellValue {
    const token = eat();
    if (!token) return null;
    if (token.type === "num") return Number(token.value);
    if (token.type === "str") return token.value;
    if (token.type === "ref") return get(token.value);
    if (token.type === "range") {
      const values = numbersOnly(expandRange(token.value).map(get));
      return values.length ? values[0]! : null;
    }
    if (token.type === "op" && token.value === "-") return -num(parsePrimary());
    if (token.type === "op" && token.value === "+") return parsePrimary();
    if (token.type === "paren" && token.value === "(") {
      const value = parseComparison();
      if (peek()?.value === ")") pos++;
      return value;
    }
    if (token.type === "fn") {
      if (peek()?.value === "(") pos++;
      const args: CellValue[][] = [];
      if (peek()?.value !== ")") {
        args.push(parseArg());
        while (peek()?.type === "sep") {
          pos++;
          args.push(parseArg());
        }
      }
      if (peek()?.value === ")") pos++;
      return applyFunction(token.value, args);
    }
    return null;
  }

  function parsePower(): CellValue {
    let left = parsePrimary();
    while (peek()?.type === "op" && peek()!.value === "^") {
      pos++;
      left = Math.pow(num(left), num(parsePrimary()));
    }
    if (peek()?.type === "op" && peek()!.value === "%") {
      pos++;
      left = num(left) / 100;
    }
    return left;
  }

  function parseTerm(): CellValue {
    let left = parsePower();
    while (peek()?.type === "op" && ["*", "/"].includes(peek()!.value)) {
      const op = eat()!.value;
      const right = parsePower();
      if (op === "*") left = num(left) * num(right);
      else {
        const d = num(right);
        left = d === 0 ? null : num(left) / d;
      }
    }
    return left;
  }

  function parseSum(): CellValue {
    let left = parseTerm();
    while (peek()?.type === "op" && ["+", "-", "&"].includes(peek()!.value)) {
      const op = eat()!.value;
      const right = parseTerm();
      if (op === "&") left = `${left ?? ""}${right ?? ""}`;
      else left = op === "+" ? num(left) + num(right) : num(left) - num(right);
    }
    return left;
  }

  function parseComparison(): CellValue {
    let left = parseSum();
    while (peek()?.type === "op" && ["=", "<", ">", "<=", ">=", "<>"].includes(peek()!.value)) {
      const op = eat()!.value;
      const right = parseSum();
      const bothNumbers = typeof left !== "string" && typeof right !== "string";
      const a: number | string = bothNumbers ? num(left) : String(left ?? "");
      const b: number | string = bothNumbers ? num(right) : String(right ?? "");
      const result =
        op === "=" ? a === b : op === "<>" ? a !== b : op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
      left = result ? 1 : 0;
    }
    return left;
  }

  function applyFunction(name: string, args: CellValue[][]): CellValue {
    const flat = args.flat();
    const nums = numbersOnly(flat);
    const first = args[0]?.[0] ?? null;
    switch (name) {
      case "SUM":
      case "SOMME":
        return nums.reduce((a, b) => a + b, 0);
      case "AVERAGE":
      case "MOYENNE":
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      case "MIN":
        return nums.length ? Math.min(...nums) : null;
      case "MAX":
        return nums.length ? Math.max(...nums) : null;
      case "COUNT":
      case "NB":
        return nums.length;
      case "COUNTA":
      case "NBVAL":
        return flat.filter((v) => v !== null && v !== "").length;
      case "ROUND":
      case "ARRONDI": {
        const digits = args[1]?.[0] !== undefined ? num(args[1]![0]!) : 0;
        const factor = Math.pow(10, digits);
        return Math.round(num(first) * factor) / factor;
      }
      case "INT":
      case "ENT":
        return Math.floor(num(first));
      case "ABS":
        return Math.abs(num(first));
      case "IF":
      case "SI": {
        const cond = num(first) !== 0;
        
        const branch = cond ? args[1] : args[2];
        return branch?.[0] ?? (cond ? 1 : 0);
      }
      case "IFERROR":
      case "SIERREUR":
        return first === null ? (args[1]?.[0] ?? null) : first;
      case "AND":
      case "ET":
        return flat.every((v) => num(v) !== 0) ? 1 : 0;
      case "OR":
      case "OU":
        return flat.some((v) => num(v) !== 0) ? 1 : 0;
      case "CONCATENATE":
      case "CONCAT":
      case "CONCATENER":
        return flat.map((v) => (v === null ? "" : String(v))).join("");
      case "RANK":
      case "RANG": {
        const value = num(first);
        const pool = numbersOnly(args[1] ?? []);
        const ascending = args[2]?.[0] !== undefined && num(args[2]![0]!) !== 0;
        const sorted = [...pool].sort((a, b) => (ascending ? a - b : b - a));
        const idx = sorted.findIndex((v) => v === value);
        return idx === -1 ? null : idx + 1;
      }
      default:
        throw new UnsupportedFormulaError(name);
    }
  }

  const result = parseComparison();
  return result;
}
