import { useMemo } from "react";
import type { CIConfig } from "../types";
import { wrapForPreview } from "../lib/snippets";

interface Props {
  html: string;
  ci: CIConfig;
  height?: number | string;
}

export function HtmlPreview({ html, ci, height = "100%" }: Props) {
  const doc = useMemo(() => wrapForPreview(html, ci), [html, ci]);
  return (
    <iframe
      title="HTML Preview"
      sandbox="allow-same-origin"
      srcDoc={doc}
      style={{
        width: "100%",
        height,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: ci.colors.background,
      }}
    />
  );
}
