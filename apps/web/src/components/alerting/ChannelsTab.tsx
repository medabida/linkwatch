import { type ChannelDto, channelCreateSchema, channelUpdateSchema } from "@linkwatch/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "../../lib/api.js";
import { relativeTime } from "../../lib/dashboard.js";
import { Modal } from "../Modal.js";

interface FormState {
  name: string;
  botToken: string;
  chatId: string;
  enabled: boolean;
}
const EMPTY: FormState = { name: "", botToken: "", chatId: "", enabled: true };

export function ChannelsTab() {
  const qc = useQueryClient();
  const channels = useQuery({ queryKey: ["alerts", "channels"], queryFn: api.channels });
  const [editing, setEditing] = useState<ChannelDto | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["alerts"] });
  const close = () => {
    setEditing(null);
    setErrors({});
  };
  const open = (c: ChannelDto | "new") => {
    setEditing(c);
    setErrors({});
    setForm(c === "new" ? EMPTY : { name: c.name, botToken: "", chatId: c.chatId, enabled: c.enabled });
  };

  const save = useMutation({
    mutationFn: (input: {
      create?: ReturnType<typeof channelCreateSchema.parse>;
      id?: number;
      update?: ReturnType<typeof channelUpdateSchema.parse>;
    }) => (input.create ? api.createChannel(input.create) : api.updateChannel(input.id as number, input.update as never)),
    onSuccess: () => {
      close();
      void refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.issues.length) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      else setErrors({ form: (e as Error).message });
    },
  });
  const toggle = useMutation({
    mutationFn: (c: ChannelDto) => api.updateChannel(c.id, { enabled: !c.enabled }),
    onSuccess: () => void refresh(),
  });
  const remove = useMutation({ mutationFn: api.deleteChannel, onSuccess: () => void refresh() });
  const test = useMutation({
    mutationFn: api.testChannel,
    onSuccess: () => setNotice({ kind: "info", text: "Test message sent. Check your Telegram chat." }),
    onError: (e) => setNotice({ kind: "error", text: (e as Error).message }),
    onSettled: () => void refresh(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (editing === "new") {
      const parsed = channelCreateSchema.safeParse(form);
      if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      setErrors({});
      save.mutate({ create: parsed.data });
    } else if (editing) {
      const parsed = channelUpdateSchema.safeParse({
        name: form.name,
        chatId: form.chatId,
        enabled: form.enabled,
        ...(form.botToken ? { botToken: form.botToken } : {}),
      });
      if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      setErrors({});
      save.mutate({ id: editing.id, update: parsed.data });
    }
  };
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <p className="muted">
        Where alerts are sent. Alerts always show in the app; add a Telegram chat to also get them on your phone. Rules choose which
        channels they use.
      </p>
      {notice && (
        <p
          className={notice.kind === "error" ? "banner banner-error" : "banner banner-info"}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Chat ID</th>
              <th>Bot token</th>
              <th>Enabled</th>
              <th>Last send</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {channels.data?.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name} <small className="muted">telegram</small>
                </td>
                <td>
                  <code>{c.chatId}</code>
                </td>
                <td>
                  <code>{c.tokenPreview}</code>
                </td>
                <td>
                  <input type="checkbox" aria-label={`Enable ${c.name}`} checked={c.enabled} onChange={() => toggle.mutate(c)} />
                </td>
                <td>
                  {c.lastError ? (
                    <span className="error-text">{c.lastError}</span>
                  ) : c.lastSentAt ? (
                    relativeTime(c.lastSentAt)
                  ) : (
                    <span className="muted">never</span>
                  )}
                </td>
                <td className="actions">
                  <button type="button" onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                    Send test
                  </button>
                  <button type="button" onClick={() => open(c)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (window.confirm(`Delete channel "${c.name}"? Rules using it will no longer notify there.`)) remove.mutate(c.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {channels.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No channels yet. Alerts only show in the app.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <button type="button" onClick={() => open("new")}>
          Add Telegram channel
        </button>
      </div>

      {editing && (
        <Modal title={editing === "new" ? "Add Telegram channel" : "Edit channel"} onClose={close}>
          <form onSubmit={submit} className="form" noValidate>
            {errors.form && <p className="error">{errors.form}</p>}
            <p className="muted">
              Create a bot with @BotFather to get the token, send it a message (or add it to a group), then open{" "}
              <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> to find the chat ID.
            </p>
            <label>
              Name
              <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="My phone" />
              {errors.name && <span className="error">{errors.name}</span>}
            </label>
            <label>
              Bot token
              <input
                value={form.botToken}
                onChange={(e) => set("botToken", e.target.value)}
                placeholder={editing === "new" ? "123456:ABC-DEF..." : "leave empty to keep the current token"}
                autoComplete="off"
              />
              {errors.botToken && <span className="error">{errors.botToken}</span>}
            </label>
            <label>
              Chat ID
              <input value={form.chatId} onChange={(e) => set("chatId", e.target.value)} placeholder="123456789 or -1001234567890" />
              {errors.chatId && <span className="error">{errors.chatId}</span>}
            </label>
            <label className="inline">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
              Enabled
            </label>
            <div className="actions">
              <button type="submit" disabled={save.isPending}>
                {editing === "new" ? "Add" : "Save"}
              </button>
              <button type="button" onClick={close}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
