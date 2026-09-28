/**
 * ai-assistant — Edge Function v1
 *
 * User (JWT) → Gemini gemini-2.5-flash-lite → tools → Supabase (user JWT)
 * → has_establishment_access → JSON → Gemini → reply
 *
 * Never service role. Never send JWT to Gemini. GEMINI_API_KEY from Deno.env only.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertActiveAdmin, runTool } from "./tools.ts";

const MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_TOOL_ROUNDS = 5;
const MAX_MESSAGE_LEN = 2000;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_INSTRUCTION =
  `Tu es l'assistant scolaire de l'application Les Élites de Gao.
Tu réponds en français, de façon claire et factuelle.
Tu utilises uniquement les tools fournis pour obtenir des données.
Tu n'inventes jamais de notes, moyennes ou effectifs.
Si un tool renvoie source "incomplete", dis clairement que les données officielles (bulletins) sont insuffisantes.
Si un tool renvoie une erreur, explique-la simplement sans jargon technique.
Ne demande jamais et n'affiche jamais de numéros de téléphone, données financières ou chemins de fichiers.`;

const TOOL_DECLARATIONS = [
  {
    name: "get_class_statistics",
    description:
      "Retourne les statistiques officielles d'une classe pour une période scolaire : effectif, moyenne de classe, admis / excellents / en difficulté, moyennes par matière, meilleurs élèves et élèves en difficulté. Les moyennes officielles proviennent uniquement des bulletins (general_average). Sans données officielles, source = incomplete.",
    parameters: {
      type: "object",
      properties: {
        class_id: {
          type: "string",
          description: "UUID de la classe (classes.id)",
        },
        period_id: {
          type: "string",
          description:
            "UUID de la période (grade_periods.id). Prioritaire s'il est fourni.",
        },
        period_number: {
          type: "integer",
          description:
            "Numéro de période dans la classe. Ignoré si period_id est fourni.",
        },
      },
      required: ["class_id"],
    },
  },
  {
    name: "get_student",
    description:
      "Retourne la fiche synthétique d'un élève : identité scolaire, classe, établissement, moyenne générale officielle et moyennes par matière si un bulletin a été calculé, sinon un résumé des notes brutes non officielles.",
    parameters: {
      type: "object",
      properties: {
        student_id: {
          type: "string",
          description: "UUID de l'élève (students.id). Prioritaire.",
        },
        first_name: {
          type: "string",
          description: "Prénom (recherche si student_id absent)",
        },
        last_name: {
          type: "string",
          description: "Nom de famille (recherche si student_id absent)",
        },
        class_id: {
          type: "string",
          description:
            "UUID de classe pour désambiguïser une recherche par nom",
        },
        period_id: {
          type: "string",
          description: "UUID de période (grade_periods.id)",
        },
        period_number: {
          type: "integer",
          description: "Numéro de période de la classe de l'élève",
        },
      },
      required: [],
    },
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

type GeminiPart = Record<string, unknown>;
type GeminiContent = { role: string; parts: GeminiPart[] };

async function callGemini(
  apiKey: string,
  contents: GeminiContent[],
): Promise<Record<string, unknown>> {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Gemini HTTP", res.status, text.slice(0, 300));
    throw new Error("GEMINI_HTTP");
  }
  return (await res.json()) as Record<string, unknown>;
}

function extractModelParts(geminiJson: Record<string, unknown>): {
  parts: GeminiPart[];
  text: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
} {
  const candidates = geminiJson.candidates as
    | { content?: { parts?: GeminiPart[] } }[]
    | undefined;
  const parts = candidates?.[0]?.content?.parts ?? [];
  let text = "";
  const functionCalls: { name: string; args: Record<string, unknown> }[] = [];
  for (const p of parts) {
    if (typeof p.text === "string") text += p.text;
    const fc = p.functionCall as
      | { name?: string; args?: Record<string, unknown> }
      | undefined;
    if (fc?.name) {
      functionCalls.push({ name: fc.name, args: fc.args ?? {} });
    }
  }
  return { parts, text, functionCalls };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        error: { code: "VALIDATION", message: "Méthode non autorisée." },
      },
      405,
    );
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Session non authentifiée.",
          },
        },
        401,
      );
    }
    const jwt = authHeader.slice(7).trim();
    if (!jwt) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Session non authentifiée.",
          },
        },
        401,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!supabaseUrl || !supabaseAnon) {
      console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "Configuration serveur incomplète.",
          },
        },
        500,
      );
    }
    if (!geminiKey) {
      console.error("Missing GEMINI_API_KEY");
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "Configuration serveur incomplète.",
          },
        },
        500,
      );
    }

    const sb = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authFail = await assertActiveAdmin(sb);
    if (authFail) {
      const status = authFail.error.code === "FORBIDDEN" ? 403 : 401;
      return jsonResponse(authFail, status);
    }

    let body: { message?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: { code: "VALIDATION", message: "Corps JSON invalide." },
        },
        400,
      );
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "Le champ message est obligatoire.",
          },
        },
        400,
      );
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: `Message trop long (max ${MAX_MESSAGE_LEN} caractères).`,
          },
        },
        400,
      );
    }

    const contents: GeminiContent[] = [
      { role: "user", parts: [{ text: message }] },
    ];

    let finalText = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const geminiJson = await callGemini(geminiKey, contents);
      const { parts, text, functionCalls } = extractModelParts(geminiJson);

      if (!functionCalls.length) {
        finalText = text.trim();
        break;
      }

      contents.push({
        role: "model",
        parts: parts.length ? parts : [{ text: text || "" }],
      });

      const responseParts: GeminiPart[] = [];
      for (const fc of functionCalls) {
        const result = await runTool(sb, fc.name, fc.args ?? {});
        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: result,
          },
        });
      }
      contents.push({ role: "user", parts: responseParts });
    }

    if (!finalText) {
      try {
        const last = await callGemini(geminiKey, contents);
        finalText = extractModelParts(last).text.trim();
      } catch {
        /* fall through */
      }
    }

    if (!finalText) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "Impossible d'obtenir une réponse de l'assistant.",
          },
        },
        500,
      );
    }

    return jsonResponse({
      ok: true,
      data: { reply: finalText },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("ai-assistant error", msg);
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "INTERNAL",
          message: "Une erreur interne est survenue.",
        },
      },
      500,
    );
  }
});
