import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { cefArchiveName, cefBuild, cefBuildDirectoryName } from "./cef-build-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cefIndexUrl = "https://cef-builds.spotifycdn.com/index.json";
const args = new Set(process.argv.slice(2));
const argValue = (name, fallback) => {
  const prefix = `${name}=`;
  const found = [...args].find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const platform = argValue("--platform", detectCefPlatform());
const fileType = argValue("--type", cefBuild.fileType);
const channel = argValue("--channel", cefBuild.channel);
const download = args.has("--download");
const outDir = path.resolve(argValue("--out", path.join(root, "vendor", "cef")));

if (!platform) {
  throw new Error(`Unsupported CEF platform for ${os.platform()} ${os.arch()}.`);
}

const index = await fetchJson(cefIndexUrl);
const selection = selectCefBuild(index, { platform, fileType, channel });
const manifest = {
  source: cefIndexUrl,
  platform,
  fileType,
  channel,
  pinned: true,
  cefVersion: selection.version.cef_version,
  chromiumVersion: selection.version.chromium_version,
  buildDirectory: cefBuildDirectoryName(platform),
  file: selection.file,
  url: `https://cef-builds.spotifycdn.com/${selection.file.name}`,
};

if (!download) {
  console.log(JSON.stringify({ ...manifest, download: false, next: "Rerun with --download to fetch the CEF binary." }, null, 2));
  process.exit(0);
}

await mkdir(outDir, { recursive: true });
const archivePath = path.join(outDir, selection.file.name);
await downloadFile(manifest.url, archivePath, selection.file.sha1);
await writeFile(path.join(outDir, "cef-download-manifest.json"), JSON.stringify(manifest, null, 2));
await extractArchive(archivePath, outDir);

console.log(JSON.stringify({ ...manifest, download: true, archivePath, outDir }, null, 2));

function detectCefPlatform() {
  const platformName = os.platform();
  const arch = os.arch();
  if (platformName === "darwin" && arch === "arm64") return "macosarm64";
  if (platformName === "darwin" && arch === "x64") return "macosx64";
  if (platformName === "linux" && arch === "arm64") return "linuxarm64";
  if (platformName === "linux" && arch === "x64") return "linux64";
  if (platformName === "win32" && arch === "arm64") return "windowsarm64";
  if (platformName === "win32" && arch === "x64") return "windows64";
  if (platformName === "win32" && arch === "ia32") return "windows32";
  return null;
}

function selectCefBuild(index, input) {
  const platformIndex = index[input.platform];
  if (!platformIndex) {
    throw new Error(`CEF platform ${input.platform} is not present in the build index.`);
  }
  const expectedArchive = cefArchiveName(input.platform);
  for (const version of platformIndex.versions) {
    if (
      version.channel !== input.channel ||
      version.cef_version !== cefBuild.cefVersion ||
      version.chromium_version !== cefBuild.chromiumVersion
    ) {
      continue;
    }
    const file = version.files.find((candidate) => candidate.type === input.fileType && candidate.name === expectedArchive);
    if (file) {
      return { version, file };
    }
  }
  throw new Error(`Pinned CEF archive ${expectedArchive} was not found in the build index.`);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`GET ${url} failed with ${response.statusCode}.`));
          response.resume();
          return;
        }
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => resolve(JSON.parse(raw)));
      })
      .on("error", reject);
  });
}

async function downloadFile(url, targetPath, expectedSha1) {
  const hash = createHash("sha1");
  await new Promise((resolve, reject) => {
    https
      .get(url, async (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`GET ${url} failed with ${response.statusCode}.`));
          response.resume();
          return;
        }
        response.on("data", (chunk) => hash.update(chunk));
        try {
          await pipeline(response, createWriteStream(targetPath));
          resolve();
        } catch (error) {
          reject(error);
        }
      })
      .on("error", reject);
  });
  const actualSha1 = hash.digest("hex");
  if (actualSha1 !== expectedSha1) {
    throw new Error(`CEF archive SHA1 mismatch: expected ${expectedSha1}, got ${actualSha1}.`);
  }
}

async function extractArchive(archivePath, targetDir) {
  const archiveName = path.basename(archivePath);
  if (!archiveName.endsWith(".tar.bz2")) {
    return;
  }
  await new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xjf", archivePath, "-C", targetDir], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}.`))));
    child.on("error", reject);
  });
}
