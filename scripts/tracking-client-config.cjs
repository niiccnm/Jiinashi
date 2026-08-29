"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(
  projectRoot,
  "dist-electron",
  "tracking-client-config.jsc",
);

function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = normalized.slice(0, separatorIndex).trim();
    const rawValue = normalized.slice(separatorIndex + 1).trim();
    values[key] = rawValue.replace(/^(['"])([\s\S]*)\1$/, "$2").trim();
  }
  return values;
}

function loadClientIds() {
  const envPath = path.join(projectRoot, ".env");
  const fileEnv = fs.existsSync(envPath)
    ? parseEnvFile(fs.readFileSync(envPath, "utf8"))
    : {};
  const mal = String(process.env.MAL_CLIENT_ID || fileEnv.MAL_CLIENT_ID || "").trim();
  const anilist = String(
    process.env.ANILIST_CLIENT_ID || fileEnv.ANILIST_CLIENT_ID || "",
  ).trim();

  if (!isValidClientId(mal)) {
    throw new Error(
      "MAL_CLIENT_ID must contain 1-256 characters without spaces.",
    );
  }
  if (!isValidClientId(anilist)) {
    throw new Error(
      "ANILIST_CLIENT_ID must contain 1-256 characters without spaces.",
    );
  }

  return { mal, anilist };
}

function isValidClientId(value) {
  return /^[^\s\p{C}]{1,256}$/u.test(value);
}

function encode(value) {
  const bytes = Buffer.from(value, "utf8");
  const mask = crypto.randomBytes(bytes.length);
  return {
    data: Array.from(bytes, (byte, index) => byte ^ mask[index]),
    mask: Array.from(mask),
  };
}

function hashClientIds(clientIds) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(clientIds), "utf8")
    .digest("hex");
}

function buildProtectedSource(clientIds) {
  const mal = encode(clientIds.mal);
  const anilist = encode(clientIds.anilist);
  return [
    '"use strict";',
    "(function () {",
    "  function decode(data, mask) {",
    "    var bytes = data.map(function (byte, index) {",
    "      return byte ^ mask[index];",
    "    });",
    '    return Buffer.from(bytes).toString("utf8");',
    "  }",
    `  var malData = ${JSON.stringify(mal.data)};`,
    `  var malMask = ${JSON.stringify(mal.mask)};`,
    `  var anilistData = ${JSON.stringify(anilist.data)};`,
    `  var anilistMask = ${JSON.stringify(anilist.mask)};`,
    "  return Object.freeze({",
    "    mal: decode(malData, malMask),",
    "    anilist: decode(anilistData, anilistMask)",
    "  });",
    "})()",
  ].join("\n");
}

async function build() {
  const clientIds = loadClientIds();
  const bytenode = require("bytenode");
  const electronPath = require("electron");
  const electronVersion = require("electron/package.json").version;
  const electronMajor = Number(electronVersion.split(".")[0]);
  const source = buildProtectedSource(clientIds);
  const bytecode =
    electronMajor >= 42 && typeof bytenode.compileElectronMainCode === "function"
      ? await bytenode.compileElectronMainCode(source, { electronPath })
      : await bytenode.compileElectronCode(source, { electronPath });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bytecode);

  for (const value of Object.values(clientIds)) {
    if (bytecode.includes(Buffer.from(value, "utf8"))) {
      throw new Error("Protected tracking configuration contains a plaintext client ID.");
    }
  }

  const validationEnvironment = { ...process.env };
  delete validationEnvironment.ELECTRON_RUN_AS_NODE;
  validationEnvironment.JIINASHI_TRACKING_CONFIG_HASH = hashClientIds(clientIds);
  const validationUserDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "jiinashi-tracking-validation-"),
  );
  try {
    const validation = spawnSync(
      electronPath,
      [
        __filename,
        "validate-bytecode",
        outputPath,
        `--user-data-dir=${validationUserDataDir}`,
      ],
      {
        cwd: projectRoot,
        env: validationEnvironment,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    if (validation.error) throw validation.error;
    if (validation.status !== 0) {
      throw new Error(
        `Protected tracking configuration validation failed (${validation.status}).`,
      );
    }
  } finally {
    fs.rmSync(validationUserDataDir, { recursive: true, force: true });
  }

  console.log("Protected tracking client configuration generated successfully.");
}

function validateBytecode(configPath) {
  const { app } = require("electron");
  const bytenode = require("bytenode");

  app.whenReady().then(() => {
    try {
      const config = bytenode.runBytecodeFile(configPath);
      const expectedHash = String(
        process.env.JIINASHI_TRACKING_CONFIG_HASH || "",
      );
      const valid =
        config &&
        isValidClientId(String(config.mal || "")) &&
        isValidClientId(String(config.anilist || "")) &&
        /^[a-f\d]{64}$/i.test(expectedHash) &&
        hashClientIds(config) === expectedHash;
      app.exit(valid ? 0 : 1);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      app.exit(1);
    }
  });
}

function listTrackedFiles() {
  const result = execFileSync("git", ["ls-files", "-z"], {
    cwd: projectRoot,
    encoding: "buffer",
  });
  return result
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((file) => path.join(projectRoot, file));
}

function collectFiles(root, output) {
  if (!fs.existsSync(root)) return;
  const stats = fs.statSync(root);
  if (stats.isFile()) {
    output.push(root);
    return;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) collectFiles(target, output);
    else if (entry.isFile()) output.push(target);
  }
}

function verify() {
  const clientIds = loadClientIds();
  const files = listTrackedFiles();
  collectFiles(path.join(projectRoot, "dist-electron"), files);

  const uniqueFiles = Array.from(new Set(files));
  for (const file of uniqueFiles) {
    let content;
    try {
      content = fs.readFileSync(file);
    } catch {
      continue;
    }
    for (const value of Object.values(clientIds)) {
      if (content.includes(Buffer.from(value, "utf8"))) {
        const relativePath = path.relative(projectRoot, file);
        throw new Error(
          `Plaintext tracking client ID detected in packaged or tracked file: ${relativePath}`,
        );
      }
    }
  }

  const packagedAsars = uniqueFiles.filter(
    (file) => path.basename(file).toLowerCase() === "app.asar",
  );
  if (packagedAsars.length === 0) {
    throw new Error("No packaged app.asar was found for tracking configuration verification.");
  }

  console.log("Tracking client ID plaintext verification passed.");
}

const command = process.argv[2];
if (command === "build") {
  build().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
} else if (command === "validate-bytecode") {
  validateBytecode(process.argv[3]);
} else if (command === "verify") {
  try {
    verify();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} else {
  console.error("Usage: node scripts/tracking-client-config.cjs <build|verify>");
  process.exitCode = 1;
}
