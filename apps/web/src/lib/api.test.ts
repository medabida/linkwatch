import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api.js";

const respond = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const stub = (res: Response) => {
  const fn = vi.fn(async () => res);
  vi.stubGlobal("fetch", fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns parsed JSON and sends a JSON content type only with a body", async () => {
    const fn = stub(respond([{ id: 1 }]));
    expect(await api.targets()).toEqual([{ id: 1 }]);
    expect(fn.mock.calls[0]).toMatchObject(["/api/targets", { headers: undefined }]);
    stub(respond({ id: 1 }));
    const post = vi.fn(async () => respond({ id: 2 }));
    vi.stubGlobal("fetch", post);
    await api.createWorker({ name: "Pi", site: "default" });
    expect(post.mock.calls[0]).toMatchObject(["/api/workers", { method: "POST", headers: { "Content-Type": "application/json" } }]);
  });

  it("treats 204 as undefined", async () => {
    stub(respond(undefined, 204));
    expect(await api.deleteTarget(1)).toBeUndefined();
  });

  it("throws ApiError with the server message, status and issues", async () => {
    stub(respond({ error: "Validation failed", issues: [{ path: "label", message: "bad" }] }, 400));
    const err = await api.createTarget({} as never).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: "Validation failed", status: 400, issues: [{ path: "label", message: "bad" }] });
  });

  it("falls back to a generic message for non-JSON errors", async () => {
    stub(new Response("<html>", { status: 502 }));
    const err = await api.health().catch((e) => e);
    expect(err).toMatchObject({ message: "Request failed (502)", status: 502, issues: [] });
  });

  it("builds the runs query, skipping empty values", async () => {
    const fn = stub(respond({ rows: [], total: 0 }));
    await api.runs({ page: 2, pageSize: 25, sortBy: "startedAt", sortDir: "desc", workerId: "w 1", site: "", status: undefined });
    const url = new URL(String((fn.mock.calls[0] as unknown[])[0]), "http://x");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "2",
      pageSize: "25",
      sortBy: "startedAt",
      sortDir: "desc",
      workerId: "w 1",
    });
  });

  it("encodes the worker id when listing targets and uses the right verbs", async () => {
    const fn = stub(respond([]));
    await api.targets("a/b");
    expect((fn.mock.calls[0] as unknown[])[0]).toBe("/api/targets?workerId=a%2Fb");
    const verbs: Record<string, () => Promise<unknown>> = {
      PATCH: () => api.updateWorker("w1", { enabled: false }),
      PUT: () => api.updateTarget(1, {} as never),
      DELETE: () => api.deleteWorker("w1"),
    };
    for (const [verb, call] of Object.entries(verbs)) {
      const f = vi.fn(async () => respond({}));
      vi.stubGlobal("fetch", f);
      await call();
      expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ method: verb });
    }
  });
});
