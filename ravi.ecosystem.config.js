// CUSTOMIZED PM2 process file for Watcharr, used on Ravi's VPS.
// It runs the app from /srv/Appdata/local/watcharr, wherever this file is kept.
// Most people should use example.ecosystem.config.js (the generic one) instead.
// Copy this file to /home/raviwarrier/ecosystem.config.js on the VPS, as start_pm2.sh expects.

const fs = require("fs");
const path = require("path");

// Target directory where Watcharr is installed
const appDir = "/srv/Appdata/local/watcharr";

// Read a value from .env.local (written by the install script), with a fallback.
function readEnv(name, fallback) {
  try {
    const match = fs.readFileSync(path.join(appDir, ".env.local"), "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    if (match) return match[1].trim();
  } catch {
    // No .env.local yet; use the fallback.
  }
  return fallback;
}

module.exports = {
  apps: [
    {
      name: "watcharr",
      cwd: appDir,
      // Run Next.js directly with node, so PM2 supervises the real server process.
      interpreter: "node",
      script: path.join(appDir, "node_modules", "next", "dist", "bin", "next"),
      args: `start -p ${readEnv("PORT", "4242")}`,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",
      time: true,
      out_file: path.join(appDir, ".watcharr", "pm2.out.log"),
      error_file: path.join(appDir, ".watcharr", "pm2.err.log"),
    },
  ],
};
