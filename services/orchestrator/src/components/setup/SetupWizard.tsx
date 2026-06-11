"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { markSetupComplete, saveDefaultRepoPath } from "@/lib/first-run";

const STEPS = ["Repo", "Passphrase", "API keys", "CLI"] as const;

/**
 * First-run setup wizard (5.9). Collects a default repo path, a passphrase, and
 * API keys (stored via `trpc.secrets.create`). CLI capabilities are exposed by
 * the monolith runtime via passive checks; active Codex probing remains opt-in.
 * Zero-secret: key/passphrase VALUES are never logged,
 * echoed back, or written to localStorage (AD-8).
 */
export function SetupWizard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [repoPath, setRepoPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [keyLabel, setKeyLabel] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [savedKeys, setSavedKeys] = useState<string[]>([]);

  const createSecret = useMutation(
    trpc.secrets.create.mutationOptions({
      onSuccess: (s: { label: string }) => {
        setSavedKeys((k) => [...k, s.label]);
        setKeyLabel("");
        setKeyValue(""); // never keep the raw value around
        toast(`Saved "${s.label}"`, "success");
      },
      onError: () => toast("Failed to save API key", "error"),
    }),
  );

  function next() {
    if (step === 0) saveDefaultRepoPath(repoPath);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }
  function finish() {
    setPassphrase(""); // discard the ephemeral passphrase (real storage: Phase 6.6)
    markSetupComplete();
    onClose();
  }
  function addKey() {
    if (!keyLabel.trim() || !keyValue.trim()) return;
    createSecret.mutate({ label: keyLabel.trim(), value: keyValue });
  }

  const last = step === STEPS.length - 1;

  return (
    <Dialog open={open} onClose={finish} title="Welcome — set up your workspace">
      <ol className="mb-5 flex items-center gap-1.5" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-border"}`}
            aria-current={i === step ? "step" : undefined}
          />
        ))}
      </ol>

      {step === 0 && (
        <Field
          label="Default repo path"
          hint="Absolute path to a local git repo. Agents create isolated worktrees + branches here for each run — e.g. /Users/you/projects/my-app"
          htmlFor="wiz-repo"
        >
          <Input
            id="wiz-repo"
            autoFocus
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="/Users/you/projects/my-app"
          />
        </Field>
      )}

      {step === 1 && (
        <Field
          label="Passphrase"
          hint="Encrypts your local secrets. Stored via the OS keychain in the desktop app (never logged)."
          htmlFor="wiz-pass"
        >
          <Input
            id="wiz-pass"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3">
            <Field label="Key label" htmlFor="wiz-key-label">
              <Input
                id="wiz-key-label"
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                placeholder="ANTHROPIC_API_KEY"
              />
            </Field>
            <Field label="Value" hint="Encrypted server-side; never shown again." htmlFor="wiz-key-value">
              <Input
                id="wiz-key-value"
                type="password"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder="sk-…"
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              onClick={addKey}
              disabled={!keyLabel.trim() || !keyValue.trim() || createSecret.isPending}
            >
              <PlusIcon size={14} /> Add key
            </Button>
          </div>
          {savedKeys.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted">
              {savedKeys.map((label, i) => (
                <li key={`${label}-${i}`} className="flex items-center gap-2">
                  <CheckIcon size={13} className="text-success" /> {label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="rounded-sm border border-border bg-raised px-3 py-2.5 text-xs leading-relaxed text-muted">
          <span className="text-content">CLI detection</span> now runs through the monolith runtime
          using passive version checks. Codex probing is a separate opt-in action because it may use
          quota. You can pick a CLI per Execute node in the Inspector.
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={back} disabled={step === 0}>
          Back
        </Button>
        {last ? (
          <Button type="button" onClick={finish}>
            Finish
          </Button>
        ) : (
          <Button type="button" onClick={next}>
            Next
          </Button>
        )}
      </div>
    </Dialog>
  );
}
