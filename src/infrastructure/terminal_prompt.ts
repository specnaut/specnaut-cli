import type { InteractivePrompt } from "../application/ports.ts";

export class TerminalPrompt implements InteractivePrompt {
  select(
    message: string,
    choices: ReadonlyArray<{ label: string; value: string }>,
  ): Promise<string> {
    console.log(message);
    choices.forEach((c, i) => console.log(`  ${i + 1}) ${c.label}`));
    const raw = prompt(`Choose [1-${choices.length}]:`)?.trim() ?? "";
    const idx = parseInt(raw, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= choices.length) {
      throw new Error(`Invalid choice: ${raw}`);
    }
    return Promise.resolve(choices[idx].value);
  }

  confirm(message: string, defaultYes: boolean): Promise<boolean> {
    const suffix = defaultYes ? " (Y/n) " : " (y/N) ";
    const raw = prompt(message + suffix)?.trim().toLowerCase() ?? "";
    if (raw === "") return Promise.resolve(defaultYes);
    return Promise.resolve(raw.startsWith("y"));
  }

  text(message: string, defaultValue?: string): Promise<string> {
    const raw = prompt(message, defaultValue)?.trim();
    return Promise.resolve(raw ?? defaultValue ?? "");
  }
}
