// Thin wrapper around the OpenAI Chat Completions endpoint. Kept
// dependency-free (no `openai` npm package) because the request /
// response surface we need is tiny — a POST with JSON — and adding
// an SDK just for two endpoints doubles the client's install size.
//
// Environment:
//   OPENAI_API_KEY — required for real calls. Missing key throws;
//     the route handler catches and writes status='failed' with an
//     error_message pointing at the missing env.
//
// Data-minimization: callers never pass StoneDash identifiers to
// this module. It sees the file bytes, the mime type, and the
// prompts — nothing else.
//
// No "server-only" guard: dependency-free wrapper around fetch +
// process.env.OPENAI_API_KEY. Safe to import from a Node script
// (e.g. scripts/smoke_intake_real.ts) as well as the Next.js
// route handlers.

import { costCents, isPricedModel } from "./cost";
import type { PricedModel } from "./cost";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

type MessageContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type Message = {
  role: "system" | "user";
  content: string | MessageContent[];
};

type ChatCompletionResponse = {
  choices: { message: { content: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type CallOpts = {
  model: PricedModel;
  system: string;
  userContent: MessageContent[];
  // If provided, response_format is set to json_schema with strict
  // validation. Otherwise the caller gets the raw string content and
  // parses themselves.
  jsonSchema?: Record<string, unknown>;
};

export type OpenAiCallResult = {
  content: string;
  costCents: number;
  usage: { input: number; output: number };
};

// Fires a one-time process-wide warning when OPENAI_API_KEY is
// missing. Mirrors the Google Maps key pattern from location-
// autocomplete.tsx: we don't crash — we just want the dev to notice.
let missingKeyWarned = false;
function warnMissingKeyOnce(): void {
  if (missingKeyWarned) return;
  missingKeyWarned = true;
  process.stderr.write(
    "[extraction] OPENAI_API_KEY is not set. Extractions will fail with " +
      "status='failed' until you configure it. Set NEXT_PUBLIC_MOCK_AI=1 " +
      "to develop UI without a real key.\n",
  );
}

function getKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    warnMissingKeyOnce();
    throw new Error(
      "OPENAI_API_KEY is not set. See README > AI document extraction.",
    );
  }
  return key;
}

export async function callChatCompletions({
  model,
  system,
  userContent,
  jsonSchema,
}: CallOpts): Promise<OpenAiCallResult> {
  const key = getKey();
  if (!isPricedModel(model)) {
    // Compile-time enum, but a defensive guard in case a future
    // caller passes a string that TypeScript can't verify.
    throw new Error(`Unknown model: ${model}`);
  }

  const messages: Message[] = [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];

  const body: Record<string, unknown> = {
    model,
    messages,
    // 0 temperature — this is extraction, not generation. Same input
    // should give same output.
    temperature: 0,
  };
  if (jsonSchema) {
    body.response_format = { type: "json_schema", json_schema: jsonSchema };
  } else {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = (await res.json()) as ChatCompletionResponse;
  const content = json.choices[0]?.message?.content ?? "";
  const inputTokens = json.usage?.prompt_tokens ?? 0;
  const outputTokens = json.usage?.completion_tokens ?? 0;

  return {
    content,
    costCents: costCents(model, inputTokens, outputTokens),
    usage: { input: inputTokens, output: outputTokens },
  };
}
