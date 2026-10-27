import { it, expect, vi } from "vitest";
import { callJson } from "../src/server/meta";
import { z } from "zod";
it("uses Meta standard model and validates the returned contract", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      choices: [
        { finish_reason: "stop", message: { content: '{"answer":"ok"}' } },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }),
  );
  const result = await callJson(
    "test-key",
    "Return JSON",
    { input: "data" },
    z.object({ answer: z.string() }),
    fetcher as typeof fetch,
  );
  expect(result.value.answer).toBe("ok");
  const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(args[0]).toBe("https://api.meta.ai/v1/chat/completions");
  expect(JSON.parse(String(args[1].body)).model).toBe("muse-spark-1.3");
});
it("rejects a truncated model result", async () => {
  const fetcher = async () =>
    Response.json({
      choices: [{ finish_reason: "length", message: { content: "{}" } }],
    });
  await expect(
    callJson(
      "test-key",
      "Return JSON",
      {},
      z.object({ answer: z.string() }),
      fetcher as typeof fetch,
    ),
  ).rejects.toMatchObject({ code: "MODEL_INCOMPLETE" });
});
