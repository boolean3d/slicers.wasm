// farm-helper/bambu-home/autostart.mjs — the helper starts with the computer, the way each system starts a person's own
// programs (nothing to administer, no password): a systemd user service on Linux and a Raspberry Pi (an @reboot line in
// the crontab where there is no systemd), a LaunchAgent on a Mac, a line in the Startup folder on Windows. `install`
// and `uninstall` in helper.mjs. Node only, no packages. MIT licence (LICENSE beside this file).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const NAME = "boolean3d-helper";
const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const has = (cmd) => { try { run(process.platform === "win32" ? "where" : "which", [cmd]); return true; } catch { return false; } };

/**
 * Start `program` (its words: [executable, ...arguments]) with this computer (on = true), or no longer (on = false).
 * Resolves to one sentence for the screen. `file`: a helper file other than the usual one, passed on.
 */
export async function autostart(on, program, { file = null, platform = process.platform, home = os.homedir() } = {}) {
  const words = file ? [...program, "--file", file] : program;
  if (platform === "win32") return windows(on, words, home);
  if (platform === "darwin") return mac(on, words, home);
  return linux(on, words, home);
}

function windows(on, words, home) {
  const startup = path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  const cmd = path.join(startup, "Boolean3d helper.cmd");
  if (!on) { fs.rmSync(cmd, { force: true }); return "The helper no longer starts with this computer."; }
  fs.mkdirSync(startup, { recursive: true });
  // a small window, kept out of the way; closing it stops the helper until the next sign-in
  fs.writeFileSync(cmd, `@echo off\r\nstart "Boolean3d printer helper" /min ${words.map(quote).join(" ")}\r\n`);
  return "The helper starts when you sign in to this computer (Start menu > Startup).";
}

function mac(on, words, home) {
  const dir = path.join(home, "Library", "LaunchAgents");
  const plist = path.join(dir, "com.boolean3d.helper.plist");
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!on) {
    if (uid !== null) { try { run("launchctl", ["bootout", `gui/${uid}/com.boolean3d.helper`]); } catch { /* not loaded */ } }
    fs.rmSync(plist, { force: true });
    return "The helper no longer starts with this computer.";
  }
  fs.mkdirSync(dir, { recursive: true });
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.boolean3d.helper</string>
  <key>ProgramArguments</key><array>${words.map((w) => `<string>${esc(w)}</string>`).join("")}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(path.join(home, "Library", "Logs", "boolean3d-helper.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(home, "Library", "Logs", "boolean3d-helper.log"))}</string>
</dict></plist>
`);
  if (uid !== null) {
    try { run("launchctl", ["bootout", `gui/${uid}/com.boolean3d.helper`]); } catch { /* first time */ }
    run("launchctl", ["bootstrap", `gui/${uid}`, plist]);
  }
  return "The helper runs now and starts when you sign in to this Mac (its log: ~/Library/Logs/boolean3d-helper.log).";
}

function linux(on, words, home) {
  const systemd = has("systemctl") && fs.existsSync("/run/systemd/system");
  if (systemd) {
    const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "systemd", "user");
    const unit = path.join(dir, `${NAME}.service`);
    if (!on) {
      try { run("systemctl", ["--user", "disable", "--now", `${NAME}.service`]); } catch { /* not there */ }
      fs.rmSync(unit, { force: true });
      return "The helper no longer starts with this computer.";
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(unit, `[Unit]
Description=Boolean3d printer helper
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${words.map(quote).join(" ")}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`);
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", `${NAME}.service`]);
    // without this the user's services stop at sign-out and do not start at boot (a Pi nobody signs in to)
    let linger = "";
    try { run("loginctl", ["enable-linger", os.userInfo().username]); } catch { linger = " To start it at boot before anyone signs in, run once: sudo loginctl enable-linger " + os.userInfo().username; }
    return `The helper runs now and starts with this computer (systemctl --user status ${NAME}).${linger}`;
  }
  // no systemd: the crontab
  const line = `@reboot ${words.map(quote).join(" ")} >> ${quote(path.join(home, `${NAME}.log`))} 2>&1`;
  let old = "";
  try { old = run("crontab", ["-l"]); } catch { old = ""; }
  const kept = old.split("\n").filter((l) => l.trim() && !l.includes(NAME) && !words.some((w) => w.length > 8 && l.includes(w)));
  const next = (on ? [...kept, line] : kept).join("\n") + "\n";
  execFileSync("crontab", ["-"], { input: next, stdio: ["pipe", "pipe", "pipe"] });
  return on ? `The helper starts with this computer (crontab @reboot; log ${path.join(home, `${NAME}.log`)}). Start it now: run.`
    : "The helper no longer starts with this computer.";
}
