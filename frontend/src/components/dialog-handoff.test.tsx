import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Guards the "page is frozen" class of bug at its most dangerous point.
 *
 * A modal dialog sets `pointer-events: none` on <body> and restores it on
 * close. If it ever fails to restore, the app still renders but nothing
 * anywhere is clickable and the only fix is a reload — which is exactly what a
 * frozen page looks like to a user.
 *
 * The riskiest moment for that is a hand-off: the sales list closes the detail
 * dialog and opens the correction dialog in the *same* tick, so one modal
 * unmounts while another mounts. This asserts the body is left clean.
 */
function DetailToEditHandoff() {
  const [detail, setDetail] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setDetail(true)}>
        Open detail
      </button>

      {detail && (
        <Dialog open onOpenChange={(o) => !o && setDetail(false)}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Detail</DialogTitle>
            {/* The hand-off: close this and open the other, in one tick. */}
            <button
              type="button"
              onClick={() => {
                setDetail(false);
                setEditing(true);
              }}
            >
              Correct
            </button>
          </DialogContent>
        </Dialog>
      )}

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(false)}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Correct</DialogTitle>
            <button type="button" onClick={() => setEditing(false)}>
              Save
            </button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

describe("closing one dialog while opening another", () => {
  it("leaves the page clickable afterwards", async () => {
    render(<DetailToEditHandoff />);
    expect(document.body.style.pointerEvents).toBe("");

    fireEvent.click(screen.getByText("Open detail"));
    await waitFor(() => expect(document.body.style.pointerEvents).toBe("none"));

    // Hand off: detail closes and the correction dialog opens in one tick.
    fireEvent.click(screen.getByText("Correct"));
    await screen.findByText("Save");
    expect(document.body.style.pointerEvents).toBe("none"); // still modal

    fireEvent.click(screen.getByText("Save"));

    // The whole point: <body> is handed back, so the app stays usable.
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
  });
});

/**
 * The same freeze, reached from a row's "⋯" menu instead of another dialog.
 *
 * Radix flushes the item's click handler before it closes the menu, so the
 * dialog mounts while the menu is still an open modal layer — the moment where
 * the two layers have to agree about what <body> looked like before either of
 * them touched it.
 */
function MenuToDialogHandoff() {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Actions</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => setEditing(true)}>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(false)}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Edit product</DialogTitle>
            <button type="button" onClick={() => setEditing(false)}>
              Save
            </button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

describe("opening a dialog from a dropdown menu", () => {
  it("leaves the page clickable after the dialog closes", async () => {
    render(<MenuToDialogHandoff />);
    expect(document.body.style.pointerEvents).toBe("");

    // Radix opens the menu on pointerdown or a key, not on a bare click.
    fireEvent.keyDown(screen.getByText("Actions"), { key: "Enter" });
    fireEvent.click(await screen.findByText("Edit"));
    await screen.findByText("Save");

    fireEvent.click(screen.getByText("Save"));

    // The whole point: <body> is handed back, so the app stays usable.
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
  });
});
