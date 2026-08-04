#!/usr/bin/env node
// Runs `wrangler deploy`, streams its output through unchanged, then prints the
// dashboard URL in a big banner so it is impossible to miss in a deploy log
// (the one-click "Deploy to Cloudflare" build log in particular).
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

if (import.meta.url === pathToFileURL(process.argv[1]).href) deploy();

function deploy() {
  const child = spawn("npx", ["wrangler@4", "deploy", ...process.argv.slice(2)], {
    shell: true,
    stdio: ["inherit", "pipe", "pipe"],
  });

  let captured = "";
  for (const [stream, out] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      captured += chunk;
      out.write(chunk);
    });
  }

  child.on("close", (code) => {
    if (code === 0) process.stdout.write(banner(captured));
    process.exit(code ?? 1);
  });
}

export function banner(log) {
  const ansi = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
  const plain = log.replace(ansi, "");

  // The workers.dev URL is printed with its scheme; custom domains are listed
  // as bare hostnames in the triggers section.
  const urls = new Set();
  for (const m of plain.matchAll(/https:\/\/[^\s"'<>]*\.workers\.dev[^\s"'<>]*/g)) {
    urls.add(m[0].replace(/[.,)]+$/, ""));
  }
  for (const m of plain.matchAll(/^\s+([a-z0-9-]+(?:\.[a-z0-9-]+)+)\s+\(custom domain\)/gim)) {
    urls.add(`https://${m[1]}`);
  }
  if (urls.size === 0) return "";

  const lines = [
    "DEPLOYED - OPEN YOUR DASHBOARD AT:",
    "",
    ...[...urls].map((u) => `  >>  ${u}`),
    "",
    "First visit walks you through creating the owner account.",
  ];

  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = "=".repeat(width);
  const pad = (l) => `| ${l}${" ".repeat(width - l.length - 4)} |`;

  return `\n\n${[bar, ...lines.map(pad), bar].join("\n")}\n\n`;
}
