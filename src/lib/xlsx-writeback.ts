/**
 * REMPLISSAGE DU CLASSEUR EXCEL ORIGINAL — fidélité au modèle importé.
 *
 * 1. Part du fichier .xlsx d'origine.
 * 2. N'écrit que les entrées (notes, balises [prenom]/[nom]…).
 * 3. Ne touche jamais une cellule déjà en formule.
 * 4. Après écriture : fusion JSZip des media/drawings/theme d'origine
 *    (logos, photos, thème) pour coller au modèle importé.
 * 5. Moyennes = formules du modèle uniquement (pas de reduce JS).
 */
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { evaluateFormula, UnsupportedFormulaError, type CellValue } from "@/lib/xlsx-formula";
import {
  colIndex,
  isSubjectLabel,
  matchSubjectName,
  normalize,
  parseColumnTag,
  OUTPUT_COLUMN_ROLES,
  INPUT_NOTE_ROLES,
  type TemplateMapping,
  type FillData,
  type ComputedAverages,
  type FieldRole,
  type PeriodStat,
} from "@/lib/xlsx-template";

const toScale = (v: number | null, scale: number) =>
  v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))
    ? null
    : Math.round(((v / 20) * scale) * 100) / 100;

/** Note de période à l'index (annuel) — null si trou / non renseigné. */
const periodEval = (evals: number[], idx: number | null | undefined): number | null => {
  if (idx == null || idx < 0 || idx >= evals.length) return null;
  const v = evals[idx] as number | null | undefined;
  return v != null && typeof v === "number" && Number.isFinite(v) ? v : null;
};
const fromScale = (v: unknown, scale: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(((v / scale) * 20) * 100) / 100 : null;

const PRE_FORMULA_FIELDS = new Set<FieldRole>([
  "student_name",
  "student_first_name",
  "student_last_name",
  "class_name",
  "establishment_name",
  "period_label",
  "headcount",
  "rank",
  "first_average",
  "last_average",
  "class_average_evaluation",
  "class_average_composition",
  "date",
]);

function fieldValue(role: FieldRole, data: FillData): number | string | null {
  switch (role) {
    case "student_name":
      return data.studentName;
    case "student_first_name":
      return data.studentFirstName;
    case "student_last_name":
      return data.studentLastName;
    case "class_name":
      return data.className;
    case "establishment_name":
      return data.establishmentName;
    case "period_label":
      return data.periodLabel;
    case "headcount":
      return data.headcount;
    case "general_average":
      return null;
    case "first_average":
      return toScale(data.firstAverage, data.scale);
    case "last_average":
      return toScale(data.lastAverage, data.scale);
    case "class_average_evaluation":
      return toScale(data.classAverageEvaluation, data.scale);
    case "class_average_composition":
      return toScale(data.classAverageComposition, data.scale);
    case "rank":
      return data.rank;
    case "date":
      return new Date().toLocaleDateString("fr-FR");
    default:
      return null;
  }
}

export async function writeFilledWorkbook(
  originalBuffer: ArrayBuffer,
  mapping: TemplateMapping,
  data: FillData,
): Promise<{ buffer: ArrayBuffer; computed: ComputedAverages; warnings: string[] }> {
  const wb = XLSX.read(originalBuffer, { type: "array", cellFormula: true, cellStyles: true });
  const ws = wb.Sheets[mapping.sheetName] ?? wb.Sheets[wb.SheetNames[0]!];
  if (!ws) throw new Error("Feuille du modele introuvable dans le fichier.");

  const warnings: string[] = [];

  // Rattrapage FORCÉ : rôles colonnes + index période (essentiel pour modèles annuels multi-trimestres).
  // On ne se fie pas au mapping stocké : on relit les en-têtes du fichier à chaque remplissage.
  // Structure fréquente (bulletin annuel) :
  //   ligne N   : Matière | 1er Trimestre | 2e Trimestre | …
  //   ligne N+1 : Coef | Note classe | Compo | Moyenne | … (répété par période)
  {
    const cols: Record<string, import("@/lib/xlsx-template").ColumnRole> = { ...mapping.columns };
    const periodCols: Record<string, number> = {};
    const maxC = Math.max(24, XLSX.utils.decode_range(ws["!ref"] ?? "A1").e.c + 1);
    const textAt = (r1: number, c0: number) => {
      const cell = ws[XLSX.utils.encode_cell({ r: r1 - 1, c: c0 })] as XLSX.CellObject | undefined;
      return cell?.v != null ? String(cell.v).trim() : "";
    };
    const isPeriodLabel = (label: string) => {
      const n = normalize(label);
      if (!n) return false;
      return (
        /\b(1\s*(er|ere|ère)?|2\s*(e|eme|ème)|3\s*(e|eme|ème)|4\s*(e|eme|ème)|5\s*(e|eme|ème)|6\s*(e|eme|ème)|premier|deuxieme|deuxième|troisieme|troisième|quatrieme|trimestre|semestre|periode|période|semester|term|quarter)\b/.test(n) ||
        /^t\s*[1-6]$/.test(n) ||
        /^p\s*[1-6]$/.test(n) ||
        /^[1-6]$/.test(n) ||
        /\b(first|second|third|fourth)\s*(term|semester|quarter)?\b/.test(n)
      );
    };
    const roleFromLabel = (label: string): import("@/lib/xlsx-template").ColumnRole | null => {
      const n = normalize(label);
      if (!n) return null;
      if (
        n.includes("notes coef") ||
        n.includes("note coef") ||
        n.includes("notes coefficient") ||
        n === "total" ||
        n.startsWith("total ")
      ) {
        return "ignore";
      }
      if (
        n.includes("note classe") ||
        n.includes("note de classe") ||
        n === "eval" ||
        n.includes("evaluation") ||
        n.includes("évaluation") ||
        n.includes("interro") ||
        ((n === "note" || n === "notes" || n === "score" || n === "grade") && !n.includes("coef"))
      ) {
        return "evaluation";
      }
      if (n.includes("compo") || n.includes("composition")) return "composition";
      if (
        (n.includes("moyenne") || n === "moy") &&
        !n.includes("annuel") &&
        !n.includes("general") &&
        !n.includes("generale") &&
        !n.includes("général") &&
        !n.includes("générale") &&
        !n.includes("premier") &&
        !n.includes("dernier")
      ) {
        return "subject_average";
      }
      if (n.startsWith("coef") || n === "coefficient" || n === "coeff") return "coefficient";
      if (n.includes("matiere") || n.includes("matière") || n === "discipline" || n === "subject") return "subject";
      return null;
    };

    // 1) Trouver la meilleure ligne d'en-têtes de colonnes (Note classe / Compo / Coef)
    let headerRow = mapping.headerRow > 0 ? mapping.headerRow : 0;
    let bestScore = -1;
    const scanMax = Math.min(30, XLSX.utils.decode_range(ws["!ref"] ?? "A1").e.r + 1);
    for (let r = 1; r <= scanMax; r++) {
      let score = 0;
      let hasNote = false;
      let hasCompo = false;
      let hasCoef = false;
      let hasSubject = false;
      for (let c = 0; c < maxC; c++) {
        const role = roleFromLabel(textAt(r, c));
        if (role === "evaluation") {
          score += 3;
          hasNote = true;
        } else if (role === "composition") {
          score += 3;
          hasCompo = true;
        } else if (role === "coefficient") {
          score += 1;
          hasCoef = true;
        } else if (role === "subject") {
          score += 2;
          hasSubject = true;
        } else if (role === "subject_average") {
          score += 1;
        }
      }
      if (hasNote || hasCompo) score += 5;
      if ((hasNote || hasCompo) && (hasCoef || hasSubject)) score += 3;
      if (score > bestScore) {
        bestScore = score;
        headerRow = r;
      }
    }
    if (bestScore < 3) {
      headerRow = mapping.headerRow > 0 ? mapping.headerRow : headerRow;
    }

    // 2) Ligne de groupes de périodes = souvent headerRow - 1 (ex. « 1er Trimestre »)
    let groupRow = 0;
    if (headerRow > 1) {
      let periodHits = 0;
      for (let c = 0; c < maxC; c++) {
        if (isPeriodLabel(textAt(headerRow - 1, c))) periodHits++;
      }
      if (periodHits > 0) groupRow = headerRow - 1;
    }
    // Si headerRow est lui-même une ligne de périodes, descendre pour les rôles colonnes
    {
      let periodHitsHere = 0;
      let noteHitsHere = 0;
      for (let c = 0; c < maxC; c++) {
        const t = textAt(headerRow, c);
        if (isPeriodLabel(t)) periodHitsHere++;
        const role = roleFromLabel(t);
        if (role === "evaluation" || role === "composition") noteHitsHere++;
      }
      if (periodHitsHere >= 1 && noteHitsHere === 0 && headerRow < scanMax) {
        for (let r = headerRow + 1; r <= Math.min(headerRow + 3, scanMax); r++) {
          let hits = 0;
          for (let c = 0; c < maxC; c++) {
            const role = roleFromLabel(textAt(r, c));
            if (role === "evaluation" || role === "composition") hits++;
          }
          if (hits > 0) {
            groupRow = headerRow;
            headerRow = r;
            break;
          }
        }
      }
    }

    // 3) Groupes de période depuis groupRow
    const groupByCol: (number | null)[] = Array(maxC).fill(null);
    if (groupRow > 0) {
      let lastIdx: number | null = null;
      const labelToIdx = new Map<string, number>();
      for (let c = 0; c < maxC; c++) {
        const label = textAt(groupRow, c);
        if (!label) {
          if (lastIdx != null) groupByCol[c] = lastIdx;
          continue;
        }
        const n = normalize(label);
        if (isPeriodLabel(label)) {
          if (!labelToIdx.has(n)) labelToIdx.set(n, labelToIdx.size);
          lastIdx = labelToIdx.get(n)!;
          groupByCol[c] = lastIdx;
        } else if (lastIdx != null) {
          groupByCol[c] = lastIdx;
        }
      }
      for (const m of (ws["!merges"] ?? []) as { s: { r: number; c: number }; e: { r: number; c: number } }[]) {
        if (m.s.r + 1 !== groupRow) continue;
        const label = textAt(groupRow, m.s.c);
        if (!label || !isPeriodLabel(label)) continue;
        const n = normalize(label);
        if (!labelToIdx.has(n)) labelToIdx.set(n, labelToIdx.size);
        const idx = labelToIdx.get(n)!;
        for (let c = m.s.c; c <= m.e.c; c++) groupByCol[c] = idx;
      }
    }

    // 4) Rôles colonnes depuis headerRow
    if (headerRow > 0) {
      for (let c = 0; c < maxC; c++) {
        const letter = XLSX.utils.encode_col(c);
        const raw = textAt(headerRow, c);
        const rawAbove = groupRow > 0 ? textAt(groupRow, c) : "";
        const tag = parseColumnTag(raw) ?? parseColumnTag(rawAbove);
        if (tag) {
          cols[letter] = tag.role;
          if (tag.periodIndex != null) periodCols[letter] = tag.periodIndex;
          else if (groupByCol[c] != null) periodCols[letter] = groupByCol[c]!;
          continue;
        }
        const role = roleFromLabel(raw);
        if (role) {
          cols[letter] = role;
          if (groupByCol[c] != null && (role === "evaluation" || role === "composition" || role === "subject_average")) {
            periodCols[letter] = groupByCol[c]!;
          }
        }
      }
      if (!Object.values(cols).includes("subject")) {
        for (let c = 0; c < maxC; c++) {
          const t1 = textAt(headerRow, c);
          const t2 = textAt(groupRow || headerRow, c);
          if (roleFromLabel(t1) === "subject" || roleFromLabel(t2) === "subject") {
            cols[XLSX.utils.encode_col(c)] = "subject";
            break;
          }
        }
        if (!Object.values(cols).includes("subject")) {
          for (let c = 0; c < Math.min(3, maxC); c++) {
            const t = textAt(groupRow || headerRow, c) || textAt(headerRow, c);
            if (normalize(t).includes("matiere") || normalize(t).includes("matière") || normalize(t) === "discipline") {
              cols[XLSX.utils.encode_col(c)] = "subject";
              break;
            }
          }
        }
      }
    }

    if (headerRow > 0 && mapping.firstSubjectRow <= headerRow) {
      mapping.firstSubjectRow = headerRow + 1;
      if (mapping.lastSubjectRow < mapping.firstSubjectRow) {
        mapping.lastSubjectRow = mapping.firstSubjectRow + 15;
      }
    }

    mapping.columns = cols;
    mapping.headerRow = headerRow;
    if (Object.keys(periodCols).length) mapping.periodColumns = periodCols;

    const evalCount = Object.values(cols).filter((r) => r === "evaluation").length;
    const compCount = Object.values(cols).filter((r) => r === "composition").length;
    if (evalCount + compCount === 0) {
      warnings.push(
        "Aucune colonne Note classe / Compo détectée dans le modèle — vérifiez l'en-tête (2 lignes : trimestres puis Note classe/Compo).",
      );
    }
  }

  /** Adresses réellement écrites (balises + notes) — seules celles-ci partent dans le .xlsx livré. */
  const touched = new Map<string, number | string>();

  const setInputCell = (address: string, value: number | string | null) => {
    const cell = ws[address] as XLSX.CellObject | undefined;
    if (cell?.f) return; // jamais écraser une formule du modèle
    if (value === null || value === undefined) {
      if (cell) {
        delete cell.v;
        delete cell.w;
      }
      touched.delete(address);
      return;
    }
    touched.set(address, value);
    ws[address] = {
      ...(cell ?? {}),
      t: typeof value === "number" ? "n" : "s",
      v: value,
    } as XLSX.CellObject;
  };

  for (const [address, role] of Object.entries(mapping.fields)) {
    if (role === "ignore" || role === "general_average") continue;
    if (!PRE_FORMULA_FIELDS.has(role)) continue;
    const cell = ws[address] as XLSX.CellObject | undefined;
    if (cell?.f) continue;
    const raw = cell?.v !== null && cell?.v !== undefined ? String(cell.v).trim() : "";
    // IMPORTANT : n'écrire QUE si la cellule est une balise pure [token]/{token}.
    // Jamais une cellule vide (mapping obsolète) ni un libellé libre.
    const isToken = /^\s*[[{].+[\]}]\s*$/.test(raw);
    if (!isToken) continue;
    setInputCell(address, fieldValue(role, data));
  }

  // Repli : balises [prenom], [nom], … même si absentes du mapping stocké
  {
    const TOKEN_ROLES: Record<string, FieldRole> = {
      prenom: "student_first_name",
      "first name": "student_first_name",
      nom: "student_last_name",
      "nom de famille": "student_last_name",
      "last name": "student_last_name",
      "nom et prenom": "student_name",
      "nom complet": "student_name",
      eleve: "student_name",
      classe: "class_name",
      class: "class_name",
      etablissement: "establishment_name",
      ecole: "establishment_name",
      lycee: "establishment_name",
      school: "establishment_name",
      periode: "period_label",
      trimestre: "period_label",
      semestre: "period_label",
      annee_scolaire: "period_label",
      "annee scolaire": "period_label",
      annee: "period_label",
      year: "period_label",
      effectif: "headcount",
      headcount: "headcount",
      rang: "rank",
      rank: "rank",
      date: "date",
      "moyenne du premier": "first_average",
      "moyenne du dernier": "last_average",
    };
    const rangeTok = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let r = rangeTok.s.r; r <= rangeTok.e.r; r++) {
      for (let c = rangeTok.s.c; c <= rangeTok.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = ws[address] as XLSX.CellObject | undefined;
        if (!cell || cell.f) continue;
        const raw = cell.v !== null && cell.v !== undefined ? String(cell.v).trim() : "";
        const m = /^\[\s*([^\]]+?)\s*\]$/.exec(raw) || /^\{\s*([^}]+?)\s*\}$/.exec(raw);
        if (!m) continue;
        const key = normalize(m[1]!);
        const role = TOKEN_ROLES[key];
        if (!role || !PRE_FORMULA_FIELDS.has(role)) continue;
        setInputCell(address, fieldValue(role, data));
      }
    }
  }

  // NOTE POUR CLAUDE: balises statistiques indexées par période (bulletins annuels
  // ou tout modèle multi-périodes) : [mg:1], [rang:2], [premier:3], [dernier:1],
  // [moy_classe:2], [effectif:3] ; suffixe « :annuel » ou sans indice = valeur annuelle/courante.
  {
    const STAT_KEYS: Record<string, keyof PeriodStat> = {
      mg: "generalAverage", moyenne: "generalAverage", "moyenne generale": "generalAverage", moy_gen: "generalAverage",
      rang: "rank",
      premier: "firstAverage", "moyenne premier": "firstAverage", "moyenne du premier": "firstAverage",
      moy_premier: "firstAverage", "moy premier": "firstAverage",
      dernier: "lastAverage", "moyenne dernier": "lastAverage", "moyenne du dernier": "lastAverage",
      moy_dernier: "lastAverage", "moy dernier": "lastAverage",
      moy_classe: "classAverage", "moyenne classe": "classAverage", effectif: "headcount",
    };
    const current: PeriodStat = {
      generalAverage: data.generalAverage, rank: data.rank, firstAverage: data.firstAverage,
      lastAverage: data.lastAverage, classAverage: data.classAverage ?? null, headcount: data.headcount,
    };
    const rangeStat = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let r = rangeStat.s.r; r <= rangeStat.e.r; r++) {
      for (let c = rangeStat.s.c; c <= rangeStat.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = ws[address] as XLSX.CellObject | undefined;
        if (!cell || cell.f || typeof cell.v !== "string") continue;
        // Formats : [premier:1], [moy_premier:2], [p1_moy_premier], [p2_premier], [mg:1]
        const rawTok = String(cell.v).trim();
        let m = /^\s*[[{]\s*([a-z_ ]+?)\s*(?::\s*(\d+|annuel|annual|an))?\s*[\]}]\s*$/i.exec(rawTok);
        let rawKey = m ? m[1]!.toLowerCase().trim() : "";
        let idx: number | null = m && m[2] && /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : null;
        if (!m) {
          const pfx = /^\s*[[{]\s*p\s*(\d+)[_\s]+([a-z_ ]+?)\s*[\]}]\s*$/i.exec(rawTok);
          if (pfx) {
            idx = Number(pfx[1]) - 1;
            rawKey = pfx[2]!.toLowerCase().trim();
            m = pfx as unknown as RegExpExecArray;
          }
        }
        if (!m || !rawKey) continue;
        const key =
          STAT_KEYS[rawKey] ??
          STAT_KEYS[normalize(rawKey)] ??
          STAT_KEYS[normalize(rawKey.replace(/_/g, " "))] ??
          (rawKey.includes("premier") || rawKey.includes("moy_premier")
            ? "firstAverage"
            : rawKey.includes("dernier") || rawKey.includes("moy_dernier")
              ? "lastAverage"
              : null);
        if (!key) continue;
        // Moyenne générale (période [mg:1] OU annuelle [mg] / sans indice) =
        // TOUJOURS sortie formule Excel → jamais d'écriture.
        // Le modèle recalcule les MG de période à partir des notes remplies.
        if (key === "generalAverage") continue;
        // Sans indice : rang/effectif/premier/dernier déjà gérés plus haut.
        // classAverage sans indice = entrée légitime (moyenne de classe connue).
        // Avec indice ([rang:2], [premier:1]…) = stats de période (bulletin annuel).
        if (idx === null && !m[2]) {
          if (key !== "classAverage") continue;
        }
        const stat = idx === null ? current : data.periodStats?.[idx];
        const raw = stat ? stat[key] : null;
        const isCount = key === "rank" || key === "headcount";
        setInputCell(address, raw == null ? null : isCount ? raw : toScale(raw, data.scale));
      }
    }
  }

  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  const rowSubjectName = new Map<number, string>();
  if (subjectColumn) {
    const remaining = new Map(data.subjects.map((s) => [normalize(s.name), s]));
    const evalLetters = Object.entries(mapping.columns)
      .filter(([, role]) => role === "evaluation")
      .map(([letter]) => letter)
      .sort((a, b) => colIndex(a) - colIndex(b));

    const usedSubjects = new Set<string>();
    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = ws[`${subjectColumn}${r}`] as XLSX.CellObject | undefined;
      const label = cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : "";
      if (!label || !isSubjectLabel(label)) continue;

      const names = data.subjects.map((s) => s.name);
      const matchedName = matchSubjectName(label, names, usedSubjects);
      const match = matchedName
        ? data.subjects.find((s) => s.name === matchedName) ?? null
        : null;
      if (!match) {
        warnings.push(`Matière non associée: « ${label} »`);
        continue;
      }
      usedSubjects.add(normalize(match.name));
      remaining.delete(normalize(match.name));
      rowSubjectName.set(r, match.name);

      const periodCols = mapping.periodColumns ?? {};
      for (const [letter, role] of Object.entries(mapping.columns)) {
        const address = `${letter}${r}`;
        // Sorties modèle : jamais d'écriture (formules Excel uniquement)
        if (OUTPUT_COLUMN_ROLES.has(role) || role === "subject") continue;
        if (!INPUT_NOTE_ROLES.has(role)) continue;

        const existing = ws[address] as XLSX.CellObject | undefined;
        if (existing?.f) continue; // formule intacte

        const periodIdx = periodCols[letter];
        if (role === "composition") {
          let raw: number | null = null;
          const comps = match.compositions;
          if (periodIdx != null && comps) {
            const v = periodIdx >= 0 && periodIdx < comps.length ? comps[periodIdx] : null;
            raw = v != null && typeof v === "number" && Number.isFinite(v) ? v : null;
          } else if (comps && comps.length > 0) {
            const compLetters = Object.entries(mapping.columns)
              .filter(([, r]) => r === "composition")
              .map(([l]) => l)
              .sort((a, b) => colIndex(a) - colIndex(b));
            const cIdx = compLetters.indexOf(letter);
            const v = cIdx >= 0 && cIdx < comps.length ? comps[cIdx] : null;
            raw = v != null && typeof v === "number" && Number.isFinite(v) ? v : null;
          } else {
            raw = match.composition;
          }
          setInputCell(address, toScale(raw, data.scale));
        } else if (role === "evaluation") {
          const raw =
            periodIdx != null
              ? periodEval(match.evaluations, periodIdx)
              : (() => {
                  const idx = evalLetters.indexOf(letter);
                  return periodEval(match.evaluations, idx >= 0 ? idx : null);
                })();
          setInputCell(address, toScale(raw, data.scale));
        }
      }
    }
    if (remaining.size > 0 && remaining.size <= 8) {
      warnings.push(
        `Matières app sans ligne modèle: ${[...remaining.keys()].slice(0, 5).join(", ")}`,
      );
    }
  }

  const formulas: { address: string; formula: string }[] = [];
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = ws[address] as XLSX.CellObject | undefined;
      if (cell?.f) formulas.push({ address, formula: String(cell.f) });
    }
  }

  const values: Record<string, CellValue> = {};
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = ws[address] as XLSX.CellObject | undefined;
      if (!cell) continue;
      if (cell.f) {
        values[address] = null;
        continue;
      }
      if (cell.t === "n" && typeof cell.v === "number") values[address] = cell.v;
      else if (cell.v === undefined || cell.v === null) values[address] = null;
      else values[address] = String(cell.v);
    }
  }

  const maxPasses = Math.max(8, formulas.length + 2);
  for (let pass = 0; pass < maxPasses; pass++) {
    for (const { address, formula } of formulas) {
      try {
        values[address] = evaluateFormula(formula, (ref) => values[ref] ?? null);
      } catch (e) {
        if (pass === maxPasses - 1 && e instanceof UnsupportedFormulaError) {
          warnings.push(`Formule non geree en ${address} : ${e.fn}`);
        }
      }
    }
  }

  // NOTE POUR CLAUDE: « Cas A » validé par l'utilisateur — la formule du modèle
  // est CONSERVÉE dans le .xlsx livré (cell.f) ; on n'y ajoute que la valeur
  // calculée (cell.v) pour un affichage immédiat. Excel recalcule à l'ouverture.
  for (const { address, formula } of formulas) {
    const result = values[address];
    const cell = ws[address] as XLSX.CellObject | undefined;
    const next: XLSX.CellObject = { ...(cell ?? {}), f: formula } as XLSX.CellObject;
    delete next.w;
    if (result === null || result === undefined) {
      delete next.v;
      next.t = "s";
    } else if (typeof result === "number") {
      next.t = "n";
      next.v = result;
    } else {
      next.t = "s";
      next.v = String(result);
    }
    ws[address] = next;
  }
  wb.Workbook = { ...(wb.Workbook ?? {}), CalcPr: { fullCalcOnLoad: "1" } } as unknown as NonNullable<XLSX.WorkBook["Workbook"]>;

  const readNumericNear = (address: string): number | null => {
    const direct = fromScale(values[address] ?? (ws[address] as XLSX.CellObject | undefined)?.v, data.scale);
    if (direct !== null) return direct;
    try {
      const { r, c } = XLSX.utils.decode_cell(address);
      for (const [dr, dc] of [
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [0, -1],
      ] as const) {
        const near = XLSX.utils.encode_cell({ r: r + dr, c: c + dc });
        const v = fromScale(values[near] ?? (ws[near] as XLSX.CellObject | undefined)?.v, data.scale);
        if (v !== null) return v;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  let generalAverage: number | null = null;
  for (const [address, role] of Object.entries(mapping.fields)) {
    if (role !== "general_average") continue;
    const v = readNumericNear(address);
    if (v !== null) generalAverage = v;
  }

  const subjectAverages: Record<string, number | null> = {};
  const subjectAverageCol = Object.entries(mapping.columns).find(([, role]) => role === "subject_average")?.[0];
  if (subjectAverageCol) {
    for (const [row, name] of rowSubjectName) {
      subjectAverages[name] = fromScale(values[`${subjectAverageCol}${row}`], data.scale);
    }
  }

  // Priorité : « Moyenne annuelle » (bulletin annuel) > « Moyenne générale ».
  // On ignore 0 (souvent formule non encore alimentée / ligne de période vide).
  if (generalAverage === null && ws) {
    const range2 = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    type Cand = { annual: boolean; v: number; row: number };
    const cands: Cand[] = [];
    for (let r = range2.s.r; r <= range2.e.r; r++) {
      let label = "";
      for (let c = range2.s.c; c <= Math.min(range2.e.c, range2.s.c + 3); c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr] as XLSX.CellObject | undefined;
        if (cell?.v != null && !cell.f) label += " " + String(cell.v);
      }
      const norm = normalize(label);
      const isAnnual =
        norm.includes("moyenne annuelle") ||
        norm.includes("moyen annuel") ||
        (norm.includes("annuel") && norm.includes("moyen"));
      const isMg =
        isAnnual ||
        (norm.includes("moyen") && (norm.includes("general") || norm.includes("generale")));
      if (!isMg) continue;
      for (let c = range2.s.c; c <= range2.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const v = fromScale(values[addr], data.scale);
        if (v !== null && Number.isFinite(v)) {
          cands.push({ annual: isAnnual, v, row: r });
          break;
        }
      }
    }
    const annualOk = cands.find((c) => c.annual && c.v > 0);
    const anyOk = cands.find((c) => c.v > 0);
    const pick = annualOk ?? anyOk ?? cands.find((c) => c.annual) ?? cands[0];
    if (pick && pick.v > 0) generalAverage = pick.v;
  }

  // Pas de fallback arithmétique : la MG doit venir uniquement des formules du modèle Excel.
  if (generalAverage === null) {
    warnings.push(
      "Moyenne générale introuvable dans le modèle (formule Excel absente ou non évaluable). Aucune moyenne inventée par l'application.",
    );
  }

  // Livraison fidèle : ExcelJS part du buffer d'origine (couleurs, styles, fusions, images).
  // On n'écrit QUE les entrées (balises + notes). Jamais de formule inventée.
  try {
    const ExcelJS = (await import("exceljs")).default;
    const ewb = new ExcelJS.Workbook();
    await ewb.xlsx.load(originalBuffer as ArrayBuffer);
    const ews = ewb.getWorksheet(mapping.sheetName) ?? ewb.worksheets[0];
    if (!ews) throw new Error("Feuille ExcelJS introuvable");

    // Écrit UNIQUEMENT les cellules touchées (balises + notes matières).
    for (const [address, value] of touched) {
      const cell = ews.getCell(address);
      if (cell.formula) continue;
      const v = cell.value as unknown;
      if (v && typeof v === "object" && "formula" in (v as object)) continue;
      cell.value = value;
    }

    const out = await ewb.xlsx.writeBuffer();
    const buffer: ArrayBuffer =
      out instanceof ArrayBuffer
        ? out
        : (out as Uint8Array).buffer.slice(
            (out as Uint8Array).byteOffset,
            (out as Uint8Array).byteOffset + (out as Uint8Array).byteLength,
          );
    return {
      buffer,
      computed: { generalAverage, subjectAverages },
      warnings: [...new Set(warnings)],
    };
  } catch (e) {
    warnings.push(
      `ExcelJS indisponible (${e instanceof Error ? e.message : "erreur"}) — repli SheetJS + media.`,
    );
  }

  const written = XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true });
  let buffer: ArrayBuffer =
    written instanceof ArrayBuffer
      ? written
      : new Uint8Array(written as number[]).buffer.slice(0);

  try {
    const origZip = await JSZip.loadAsync(originalBuffer);
    const newZip = await JSZip.loadAsync(buffer);
    for (const [path, entry] of Object.entries(origZip.files)) {
      if (entry.dir) continue;
      if (
        path.startsWith("xl/media/") ||
        path.startsWith("xl/drawings/") ||
        path.startsWith("xl/theme/") ||
        (path.includes("_rels") && (path.includes("drawing") || path.includes("sheet")))
      ) {
        newZip.file(path, await entry.async("uint8array"));
      }
    }
    buffer = await newZip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  } catch {
    /* ignore */
  }

  return {
    buffer,
    computed: { generalAverage, subjectAverages },
    warnings: [...new Set(warnings)],
  };
}

export function extractComputedAveragesFromRecalculated(
  recalculatedBuffer: ArrayBuffer,
  mapping: TemplateMapping,
  subjects: FillData["subjects"],
  scale: number,
): ComputedAverages {
  const wb = XLSX.read(recalculatedBuffer, { type: "array", cellFormula: true });
  const ws = wb.Sheets[mapping.sheetName] ?? wb.Sheets[wb.SheetNames[0]!];

  let generalAverage: number | null = null;
  if (ws) {
    for (const [address, role] of Object.entries(mapping.fields)) {
      if (role !== "general_average") continue;
      generalAverage = fromScale((ws[address] as XLSX.CellObject | undefined)?.v, scale);
    }
  }

  const subjectAverages: Record<string, number | null> = {};
  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  const subjectAverageCol = Object.entries(mapping.columns).find(([, role]) => role === "subject_average")?.[0];
  if (ws && subjectColumn && subjectAverageCol) {
    const remaining = new Map(subjects.map((s) => [normalize(s.name), s]));
    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = ws[`${subjectColumn}${r}`] as XLSX.CellObject | undefined;
      const label = cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : "";
      if (!label || !isSubjectLabel(label)) continue;
      const key = normalize(label);
      const match =
        remaining.get(key) ??
        [...remaining.entries()].find(([k]) => k.includes(key) || key.includes(k))?.[1] ??
        null;
      if (!match) continue;
      remaining.delete(normalize(match.name));
      subjectAverages[match.name] = fromScale(
        (ws[`${subjectAverageCol}${r}`] as XLSX.CellObject | undefined)?.v,
        scale,
      );
    }
  }

  return { generalAverage, subjectAverages };
}

export async function convertWorkbookOnline(
  _workbook: ArrayBuffer,
  _filename?: string,
): Promise<{ pdf: Blob; recalculated: ArrayBuffer } | null> {
  return null;
}
