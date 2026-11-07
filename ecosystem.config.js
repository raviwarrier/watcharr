// PM2 process file for Watcharr. Works on macOS, Linux and Windows.
//
// Run the install script first (it builds the app), then:
//   npm install -g pm2                 once, to install PM2
//   pm2 start ecosystem.config.js      start Watcharr in the background
//   pm2 save                           remember the process list
//   pm2 startup                        print the command that makes PM2 start at boot; run it
//
// Day to day:
//   pm2 status                         is it running?
//   pm2 logs watcharr                  live logs
//   pm2 restart watcharr | pm2 stop watcharr
//
// After updating the code, run `npm run build` and then `pm2 restart watcharr`.

const fs = require("fs");
const path = require("path");

const root = __dirname;

// Read a value from .env.local (written by the install script), with a fallback.
function readEnv(name, fallback) {
  try {
    const match = fs.readFileSync(path.join(root, ".env.local"), "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
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
      cwd: root,
      // Run Next.js directly with node, so PM2 supervises the real server process.
      interpreter: "node",
      script: path.join(root, "node_modules", "next", "dist", "bin", "next"),
      args: `start -p ${readEnv("PORT", "4242")}`,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",
      time: true,
      out_file: path.join(root, ".watcharr", "pm2.out.log"),
      error_file: path.join(root, ".watcharr", "pm2.err.log"),
    },
  ],
};
