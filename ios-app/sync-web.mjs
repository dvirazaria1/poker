// Copies the generated web app (repo root, built by build.py) into www/ for the iOS shell.
// www/ is a build artifact -- never edit it; edit kupa-sgura.html and run build.py instead.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const www = join(import.meta.dirname, "www");
const FILES = ["index.html", "manifest.webmanifest", "privacy.html", "terms.html",
  "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];

rmSync(www, { recursive: true, force: true });
mkdirSync(www);
for (const f of FILES) cpSync(join(root, f), join(www, f));
console.log("www/ <- " + FILES.join(", "));
