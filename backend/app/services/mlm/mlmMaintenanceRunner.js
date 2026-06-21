import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  getMaintenanceJob,
  listMaintenanceJobsForApi,
} from "./mlmMaintenanceJobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function validateJobOptions(job, options = {}) {
  if (job.requiresOption) {
    const val = String(options[job.requiresOption] || "").trim();
    if (!val) {
      const err = new Error(`Option "${job.requiresOption}" is required for this job.`);
      err.statusCode = 422;
      throw err;
    }
  }
  for (const opt of job.options || []) {
    if (opt.required && !String(options[opt.key] || "").trim()) {
      const err = new Error(`Option "${opt.key}" is required.`);
      err.statusCode = 422;
      throw err;
    }
  }
}

function buildArgv(job, { apply, options = {} }) {
  const args = [job.script];
  const extra = job.buildArgs ? job.buildArgs(options) : [];
  args.push(...extra.filter(Boolean));

  const shouldApply = Boolean(apply) && job.applyFlag;
  if (shouldApply) {
    args.push(job.applyFlag);
  }

  return args;
}

export function listMlmMaintenanceJobs() {
  return listMaintenanceJobsForApi();
}

export function runMlmMaintenanceJob(jobId, { apply = false, options = {}, adminId = null } = {}) {
  const job = getMaintenanceJob(jobId);
  if (!job) {
    const err = new Error(`Unknown maintenance job: ${jobId}`);
    err.statusCode = 404;
    throw err;
  }

  if (apply && job.readOnly) {
    const err = new Error("This job is read-only and cannot be applied.");
    err.statusCode = 422;
    throw err;
  }

  if (job.noDryRun && !apply) {
    const err = new Error("This job has no preview mode — use apply to run.");
    err.statusCode = 422;
    throw err;
  }

  validateJobOptions(job, options);

  const argv = buildArgv(job, { apply, options });

  console.log(
    JSON.stringify({
      level: "info",
      event: "mlm_maintenance_job_start",
      jobId: job.id,
      apply: Boolean(apply),
      adminId: adminId ? String(adminId) : null,
      argv,
    }),
  );

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(process.execPath, argv, {
      cwd: BACKEND_ROOT,
      env: process.env,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();

      console.log(
        JSON.stringify({
          level: code === 0 ? "info" : "warn",
          event: "mlm_maintenance_job_finish",
          jobId: job.id,
          exitCode: code,
          durationMs,
          timedOut,
          adminId: adminId ? String(adminId) : null,
        }),
      );

      resolve({
        jobId: job.id,
        label: job.label,
        apply: Boolean(apply),
        readOnly: Boolean(job.readOnly),
        exitCode: code,
        success: code === 0 && !timedOut,
        timedOut,
        durationMs,
        output: output.slice(-50000),
        command: `node ${argv.join(" ")}`,
      });
    });
  });
}
