import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import {
  promotionAllowed,
  type Config,
  type Proof,
} from "../src/support/engine";
import { loadSafeModeConfig } from "../src/api/safe-mode";
import { hash, time } from "../src/support/policy";
const root =
  process.env.GBUTS_SUPPORT_ROOT || "/home/ubuntu/.config/gbuts/support";
const read = (name: string) =>
  JSON.parse(readFileSync(root + "/" + name, "utf8"));
const write = (name: string, value: unknown) => {
  const p = root + "/" + name,
    tmp = p + "." + process.pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  const fd = openSync(tmp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, p);
};
const cfg = read("config.json") as Config;
const command = process.argv[2] || "--check";
if (command === "--pause") {
  write("config.json", { ...cfg, mode: "paused" });
  console.log(JSON.stringify({ mode: "paused" }));
} else if (["--check", "--activate"].includes(command)) {
  const proof = read("validation.json") as Proof,
    status = read("status.json"),
    runtime = read("runtime.json");
  const allowed =
    promotionAllowed(proof, runtime.GBUTS_SUPPORT_WORKFLOW_ID) &&
    !loadSafeModeConfig().enabled &&
    status.state === "checked" &&
    status.errors === 0 &&
    Date.now() - time(status.completedAt) < 180000;
  if (command === "--check")
    console.log(
      JSON.stringify({
        eligible: allowed,
        mode: cfg.mode,
        fixtures: proof.fixtures,
        realCases: proof.realCases,
        safeCorrect: proof.safeCorrect,
        safeTotal: proof.safeTotal,
        unsafeAuto: proof.unsafeAuto,
        invalid: proof.invalid,
      }),
    );
  else if (cfg.mode === "auto")
    console.log(JSON.stringify({ mode: "auto", unchanged: true }));
  else if (!allowed || cfg.mode !== "draft") {
    console.log(
      JSON.stringify({
        activated: false,
        reason: "VALIDATION_OR_RUNTIME_NOT_READY",
      }),
    );
    process.exitCode = 2;
  } else {
    const at = new Date().toISOString();
    write("config-before-promotion.json", cfg);
    write("promotion.json", {
      at,
      workflowId: runtime.GBUTS_SUPPORT_WORKFLOW_ID,
      policyVersion: proof.policyVersion,
      proofHash: hash(proof),
      shadowCustomerSends: status.sent,
      coveredRooms: status.scanned,
      unavailable: status.unavailable,
    });
    write("config.json", { ...cfg, mode: "auto", startAt: at, autoSince: at });
    console.log(
      JSON.stringify({
        activated: true,
        mode: "auto",
        autoSince: at,
        historicalReplay: false,
      }),
    );
  }
} else throw Error("CONTROL_COMMAND_INVALID");
