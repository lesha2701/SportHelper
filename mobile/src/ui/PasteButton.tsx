import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Button } from "./Button";

/** "Вставить из буфера": the link or code the person just copied from the email, in one tap. */
export function PasteButton({ onPaste, title = "Вставить из буфера" }: { onPaste: (text: string) => void; title?: string }) {
  const [empty, setEmpty] = useState(false);

  async function paste() {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      setEmpty(text === "");
      if (text) onPaste(text);
    } catch {
      setEmpty(true);
    }
  }

  return <Button title={empty ? "Буфер пуст: сначала скопируйте ссылку" : title} variant="secondary" onPress={paste} />;
}
