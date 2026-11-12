import { describe, expect, it } from "@jest/globals";
import { transferPhrase } from "./transferPhrase";

describe("the phrase that confirms handing the team over", () => {
  it("names the team and the person, as the server expects", () => {
    expect(transferPhrase("Спартак-2012", "Алексей", "Иванов")).toBe("Я передаю роль главного тренера команды «Спартак-2012» пользователю Алексей Иванов");
  });

  it("has no trailing space for a person without a last name", () => {
    expect(transferPhrase("Волна", "Мария", null)).toBe("Я передаю роль главного тренера команды «Волна» пользователю Мария");
    expect(transferPhrase("Волна", "Мария", undefined)).toBe("Я передаю роль главного тренера команды «Волна» пользователю Мария");
  });
});
