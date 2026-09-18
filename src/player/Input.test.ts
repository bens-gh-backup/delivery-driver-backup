import { afterEach, expect, it, vi } from "vitest";
import { Input } from "./Input";

afterEach(() => vi.unstubAllGlobals());
it("race entry requires a fresh E press; repeats and focus changes cannot queue entry", () => {
  const target = new EventTarget(); vi.stubGlobal("window", target);
  const input = new Input();
  const down = (repeat = false) => target.dispatchEvent(Object.assign(new Event("keydown"), {code:"KeyE",repeat}));
  down(); expect(input.consumeRaceEnter()).toBe(true); expect(input.consumeRaceEnter()).toBe(false);
  down(true); expect(input.consumeRaceEnter()).toBe(false);
  down(); target.dispatchEvent(new Event("blur")); expect(input.consumeRaceEnter()).toBe(false);
  down(); expect(input.consumeRaceEnter()).toBe(true);
  input.dispose(); down(); expect(input.consumeRaceEnter()).toBe(false);
});
