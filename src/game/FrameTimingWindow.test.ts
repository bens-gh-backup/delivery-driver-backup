import { expect,it } from "vitest";
import { FrameTimingWindow } from "./FrameTimingWindow";
it("reports percentiles over the bounded recent window and resets between scenes",()=>{
  const window=new FrameTimingWindow(4);
  [10,20,30,40].forEach(v=>window.add(v));
  expect(window.summarize()).toEqual({samples:4,median:25,p95:40,p99:40,max:40,over33ms:1,over50ms:0});
  window.add(12);window.add(NaN);window.add(-1);
  expect(window.summarize()).toEqual({samples:4,median:25,p95:40,p99:40,max:40,over33ms:1,over50ms:0});
  window.clear();expect(window.summarize()).toEqual({samples:0,median:0,p95:0,p99:0,max:0,over33ms:0,over50ms:0});
});

it("retains rare hitches beyond p95 and removes them when the window rolls",()=>{
  const window=new FrameTimingWindow(100);
  for(let i=0;i<99;i++)window.add(16.7);
  window.add(120);
  expect(window.summarize()).toMatchObject({p95:16.7,p99:16.7,max:120,over33ms:1,over50ms:1});
  for(let i=0;i<100;i++)window.add(16.7);
  expect(window.summarize()).toMatchObject({max:16.7,over50ms:0});
});
