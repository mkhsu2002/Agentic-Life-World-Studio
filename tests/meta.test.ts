import { afterEach, it, expect, vi } from "vitest";
import { callImage, callJson } from "../src/server/meta";
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

afterEach(() => vi.unstubAllGlobals());
it("sends actual reference images to Meta image edits without external search", async () => {
  const png = btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10));
  const fetcher = vi.fn(async () =>
    Response.json({ data: [{ b64_json: png }] }),
  );
  vi.stubGlobal("fetch", fetcher);
  const reference = `data:image/png;base64,${png}`;
  await callImage("test-key", "Keep the source visual traits", [reference]);
  const [url, request] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  const body = JSON.parse(String(request.body));
  expect(url).toBe("https://api.meta.ai/v1/images/edits");
  expect(body.images).toEqual([{ image_url: reference }]);
  expect(body.model).toBe("muse-image-1.0");
  expect(body.tool_enablement).toEqual({
    enable_image_search: false,
    enable_web_search: false,
    enable_shell: false,
  });
});
it("keeps text-only image requests on the generation endpoint", async () => {
  const png = btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10));
  const fetcher = vi.fn(async () =>
    Response.json({ data: [{ b64_json: png }] }),
  );
  vi.stubGlobal("fetch", fetcher);
  await callImage("test-key", "A landscape");
  const [url, request] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://api.meta.ai/v1/images/generations");
  expect(JSON.parse(String(request.body)).images).toBeUndefined();
});
