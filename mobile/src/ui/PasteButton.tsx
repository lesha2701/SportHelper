import { useState } from "react";
import { Button } from "./Button";

type ClipboardModule = typeof import("expo-clipboard");

/** Loaded on demand and guarded: a runtime without the native part must not crash the app at start. */
function clipboard(): ClipboardModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-clipboard") as ClipboardModule;
  } catch {
    return null;
  }
}

/** "Вставить из буфера": the link or code the person just copied from the email, in one tap. */
export function PasteButton({ onPaste, title = "Вставить из буфера" }: { onPaste: (text: string) => void; title?: string }) {
  const [problem, setProblem] = useState<"empty" | "unavailable" | null>(null);

  async function paste() {
    const module = clipboard();
    if (!module) return setProblem("unavailable");
    try {
      const text = (await module.getStringAsync()).trim();
      setProblem(text === "" ? "empty" : null);
      if (text) onPaste(text);
    } catch {
      setProblem("unavailable");
    }
  }

  const label = problem === "empty" ? "Буфер пуст: сначала скопируйте ссылку" : problem === "unavailable" ? "Вставка недоступна: вставьте вручную" : title;
  return <Button title={label} variant="secondary" onPress={paste} />;
}
