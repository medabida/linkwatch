import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal.js";

const setup = () => {
  const onClose = vi.fn();
  render(
    <Modal title="Edit thing" onClose={onClose}>
      <input aria-label="field" />
    </Modal>,
  );
  return onClose;
};

describe("Modal", () => {
  it("renders an accessible dialog with its content", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Edit thing" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Edit thing" })).toBeInTheDocument();
    expect(screen.getByLabelText("field")).toBeInTheDocument();
  });
  it("closes with the close button and Escape", async () => {
    const onClose = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText("field"), "{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("closes on a backdrop click but not on clicks inside the dialog", async () => {
    const onClose = setup();
    await userEvent.click(screen.getByLabelText("field"));
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
    await userEvent.pointer({ keys: "[MouseLeft]", target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("applies the requested width capped to the viewport", () => {
    render(
      <Modal title="Wide" onClose={() => {}} width="800px">
        x
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Wide" }).getAttribute("style")).toContain("min(800px, 92vw)");
  });
});
