import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Game } from "./game/Game";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const uiRoot = document.querySelector<HTMLDivElement>("#ui-root");

if (!canvas || !uiRoot) {
  throw new Error("Missing canvas or UI root.");
}

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: false,
  stencil: false,
  antialias: true,
});

const game = new Game(engine, canvas, uiRoot);
game.startRenderLoop();

window.addEventListener("resize", () => {
  engine.resize();
});
