import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { EthiopianDatePicker } from "./ethiopian-date-picker";

/** A date in a 30-day Ethiopian month, for tests that need to click a given day.
 *
 *  Seeding the picker from "today" makes the day grid depend on the date the
 *  suite runs: Pagumen, the 13th month, has only 5 or 6 days, so during it
 *  (roughly 6-10 September) most day numbers simply are not rendered.
 */
const IN_A_FULL_MONTH = "2026-01-15";

/** The picker as it is actually used inside a modal dialog — the sale-edit and
 *  expense forms, and the POS cart sheet on phones. */
function PickerInDialog({
  onChange = vi.fn(),
  initialValue = "",
}: {
  onChange?: (iso: string) => void;
  initialValue?: string;
}) {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState(initialValue);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Edit</DialogTitle>
        <EthiopianDatePicker
          value={value}
          onChange={(iso) => {
            setValue(iso);
            onChange(iso);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

const openCalendar = async () => {
  fireEvent.click(screen.getByRole("button", { name: /pick a date/i }));
  return screen.findByRole("dialog", { name: /pick a date/i });
};

describe("EthiopianDatePicker inside a modal dialog", () => {
  it("opts back into pointer events that the dialog disabled on <body>", async () => {
    // The regression that froze the deployed UI. Radix sets
    // `pointer-events: none` on <body> while a modal dialog is open and
    // re-enables it only on its own layer. This calendar is portalled to
    // <body>, so without an explicit opt-in it inherits `none`: it renders
    // perfectly and every click passes straight through to the overlay
    // underneath, which reads as the whole page having frozen.
    render(<PickerInDialog />);
    const panel = await openCalendar();

    await waitFor(() => expect(document.body.style.pointerEvents).toBe("none"));
    expect(panel.style.pointerEvents).toBe("auto");
  });

  it("keeps the surrounding dialog open when a day is picked", async () => {
    const onChange = vi.fn();
    render(<PickerInDialog onChange={onChange} initialValue={IN_A_FULL_MONTH} />);
    const panel = await openCalendar();

    const day = within(panel).getByRole("button", { name: "15" });
    // Radix dismisses a dialog on `pointerdown` outside its content, and this
    // panel *is* outside it now, so the pointerdown matters as much as the click.
    fireEvent.pointerDown(day);
    fireEvent.click(day);

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("closes only the calendar on Escape, leaving the dialog open", async () => {
    render(<PickerInDialog />);
    await openCalendar();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /pick a date/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("dismisses the calendar when the pointer goes down outside it", async () => {
    render(<PickerInDialog />);
    await openCalendar();

    fireEvent.pointerDown(screen.getByText("Edit"));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /pick a date/i })).not.toBeInTheDocument(),
    );
  });
});
