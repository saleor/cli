import { isCancel } from "@clack/core";
import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { menuPrompt } from "./menu-prompt.ts";
import { BACK } from "./navigation.ts";

const NAVIGATION_ROW = /○ (Back|Exit)/;

const start = (back: boolean) => {
  const input = new PassThrough();
  let screen = "";

  const output = new Writable({
    write(chunk, _encoding, done) {
      screen += chunk.toString();
      done();
    },
  });

  const answer = menuPrompt({
    back,
    choices: [
      { label: "First action", value: "first" },
      { label: "Second action", value: "second" },
    ],
    input,
    message: "Choose an action",
    output,
  });

  const key = (name: string, value?: string) =>
    input.emit("keypress", value, { name, sequence: value });

  return { answer, input, key, screen: () => stripVTControlCharacters(screen) };
};

it("shows navigation in the footer and returns Back on Escape", async () => {
  const menu = start(true);
  expect(menu.screen()).toContain("Esc: back");
  expect(menu.screen()).toContain("Ctrl+C: exit");
  expect(menu.screen()).not.toMatch(NAVIGATION_ROW);
  menu.key("escape", "\u001B");
  expect(await menu.answer).toBe(BACK);
  expect(menu.input.listenerCount("keypress")).toBe(0);
});

it("ignores Escape at the root and still accepts a selection", async () => {
  const menu = start(false);
  expect(menu.screen()).not.toContain("Esc: back");
  menu.key("escape", "\u001B");
  menu.key("down");
  menu.key("return", "\r");
  expect(await menu.answer).toBe("second");
});

it.each([false, true])(
  "keeps Ctrl+C as cancellation (back=%s)",
  async (back) => {
    const menu = start(back);
    menu.key("c", "\u0003");
    expect(isCancel(await menu.answer)).toBe(true);
    expect(menu.input.listenerCount("keypress")).toBe(0);
  }
);
