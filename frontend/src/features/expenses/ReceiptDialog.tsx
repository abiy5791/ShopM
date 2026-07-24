import { ExternalLink, ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Views an expense's receipt image in a modal (rather than a new tab), so it
 *  reads inline on desktop and full-width on a phone. Falls back to a link if
 *  the image can't load. */
export function ReceiptDialog({
  url,
  onOpenChange,
}: {
  url: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [errored, setErrored] = useState(false);
  // Reset the error state whenever a different receipt is opened.
  useEffect(() => setErrored(false), [url]);

  return (
    <Dialog open={Boolean(url)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="pr-6">Receipt</DialogTitle>
        </DialogHeader>

        {url &&
          (errored ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-12 text-center">
              <ImageOff className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">Couldn't load the image</p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-accent underline-offset-2 hover:underline"
              >
                Open in a new tab <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-center overflow-hidden rounded-md border bg-muted/30">
                <img
                  src={url}
                  alt="Expense receipt"
                  onError={() => setErrored(true)}
                  className="max-h-[70vh] w-auto max-w-full object-contain"
                />
              </div>
              <div className="text-right">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent underline-offset-2 hover:underline"
                >
                  Open original <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          ))}
      </DialogContent>
    </Dialog>
  );
}
