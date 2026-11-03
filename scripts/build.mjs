// Builds two outputs from the same source:
//   dist/index.html    self-contained page (React bundled in): deploy anywhere static
//   dist/artifact.html page body for a Claude artifact (React from cdnjs, per its CSP)
import { build, transform } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const cdnReact = process.argv.includes("--cdn-react");
const FONTS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap";
const DESC = "PocketRunway: know if your money will last the month. AI spend tagging, a runway forecast and one safe-to-spend number for students on a fixed allowance.";
const ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b1220"/><rect x="12" y="38" width="40" height="8" rx="4" fill="#233049"/><rect x="12" y="38" width="28" height="8" rx="4" fill="#e8b63a"/><path d="M16 28h10l6-10 6 10h10" fill="none" stroke="#e8b63a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>')}`;

const globals = {
  name: "react-globals",
  setup(b) {
    b.onResolve({ filter: /^react(-dom\/client)?$/ }, (args) => ({ path: args.path, namespace: "g" }));
    b.onLoad({ filter: /.*/, namespace: "g" }, (args) => ({
      contents: args.path === "react" ? "module.exports = window.React;" : "module.exports = window.ReactDOM;",
      loader: "js",
    }));
  },
};

async function bundle(useCdn) {
  const res = await build({
    entryPoints: ["src/ui/main.jsx"],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2019"],
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: useCdn ? [globals] : [],
    write: false,
    legalComments: "none",
  });
  return res.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}

const css = (await transform(await readFile("src/ui/styles.css", "utf8"), { loader: "css", minify: true })).code;
await mkdir("dist", { recursive: true });

const standalone = await bundle(false);
await writeFile(
  "dist/index.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>PocketRunway</title><meta name="description" content="${DESC}"><meta name="theme-color" content="#0b1220"><link rel="icon" href="${ICON}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONTS}"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}${css}</style></head><body><div id="root"></div><script>${standalone}</script></body></html>`,
);

const art = await bundle(true);
await writeFile(
  "dist/artifact.html",
  `<title>PocketRunway</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<meta name="description" content="${DESC}">\n<link rel="stylesheet" href="${FONTS}">\n<style>${css}</style>\n<div id="root"></div>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>\n<script>${art}</script>\n`,
);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/index.html ${kb(standalone)} JS · dist/artifact.html ${kb(art)} JS · ${cdnReact ? "(flag ignored: both builds are always written)" : ""}`);
