import { parsePackage } from "./shared/package.js";
import { requestPreview } from "./shared/viewer.js";

const input = document.getElementById("jscan-input");
const status = document.getElementById("open-status");
const result = document.getElementById("open-result");

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  status.textContent = "Reading and verifying package...";
  status.className = "status";
  result.innerHTML = "";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parsePackage(bytes);
    parsed.packageBytes = bytes;
    status.textContent = `${parsed.metadata.name} is ready. SHA-256 ${parsed.hashOk ? "verified" : "mismatch"}.`;
    status.className = `status ${parsed.hashOk ? "good" : "bad"}`;
    requestPreview(parsed, result);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.className = "status bad";
  }
});
