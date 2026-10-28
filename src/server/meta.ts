import { z } from "zod";
import { DomainError } from "./domain";
export async function callJson<T extends z.ZodType>(
  key: string,
  system: string,
  context: unknown,
  schema: T,
  fetcher: typeof fetch = fetch,
  imageUrls: string[] = [],
): Promise<{ value: z.infer<T>; usage: { input: number; output: number } }> {
  if (!key)
    throw new DomainError(
      "META_NOT_CONFIGURED",
      "Model access has not been configured",
      503,
    );
  const content = imageUrls.length
    ? [
        { type: "text", text: JSON.stringify(context) },
        ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
      ]
    : JSON.stringify(context);
  const res = await fetcher("https://api.meta.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "muse-spark-1.3",
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "RoleResult",
          strict: false,
          schema: z.toJSONSchema(schema),
        },
      },
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new DomainError(
      `META_${res.status}`,
      error.error?.code || `Model service returned ${res.status}`,
      res.status === 429 ? 429 : 502,
    );
  }
  const result = (await res.json()) as {
    choices?: {
      finish_reason: string;
      message: { content?: string; refusal?: string };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = result.choices?.[0];
  if (
    choice?.finish_reason !== "stop" ||
    !choice.message.content ||
    choice.message.refusal
  )
    throw new DomainError(
      "MODEL_INCOMPLETE",
      "The model response was incomplete or declined",
      502,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(choice.message.content);
  } catch {
    throw new DomainError(
      "MODEL_INVALID_JSON",
      "The model returned invalid JSON",
      502,
    );
  }
  const valid = schema.safeParse(parsed);
  if (!valid.success)
    throw new DomainError(
      "MODEL_CONTRACT_INVALID",
      `Model output did not match the contract: ${valid.error.issues
        .slice(0, 3)
        .map((i) => i.path.join("."))
        .join(", ")}`,
      502,
    );
  return {
    value: valid.data,
    usage: {
      input: result.usage?.prompt_tokens || 0,
      output: result.usage?.completion_tokens || 0,
    },
  };
}
export async function callImage(
  key: string,
  prompt: string,
  referenceUrls: string[] = [],
) {
  if (!key)
    throw new DomainError(
      "META_NOT_CONFIGURED",
      "Image access has not been configured",
      503,
    );
  const response = await fetch(
    `https://api.meta.ai/v1/images/${referenceUrls.length ? "edits" : "generations"}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "muse-image-1.0",
        prompt,
        ...(referenceUrls.length
          ? { images: referenceUrls.map((image_url) => ({ image_url })) }
          : {}),
        n: 1,
        response_format: "b64_json",
        output_format: "png",
        size: "1536x1024",
        tool_enablement: {
          enable_image_search: false,
          enable_web_search: false,
          enable_shell: false,
        },
      }),
      signal: AbortSignal.timeout(240000),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string };
    };
    throw new DomainError(
      `IMAGE_${response.status}`,
      body.error?.code || `Image service returned ${response.status}`,
      502,
    );
  }
  const data = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new DomainError("IMAGE_EMPTY", "No image was returned", 502);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (
    bytes.length > 20 * 1024 * 1024 ||
    bytes[0] !== 137 ||
    bytes[1] !== 80 ||
    bytes[2] !== 78 ||
    bytes[3] !== 71
  )
    throw new DomainError(
      "IMAGE_INVALID",
      "The generated image is not a valid PNG",
      502,
    );
  return { bytes, b64, contentType: "image/png" };
}
