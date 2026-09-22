"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { ButtonLoader } from "@/components/ui/loader";
import { Button, Field, PasswordInput } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";
import type { User } from "@/lib/types";

export const MIN_PASSWORD = 8;

/**
 * §6 — a user created with a temporary password must choose their own before
 * using the app. The dialog can't be dismissed; signing out is the only exit.
 */
export function FirstSignInPassword({ user }: { user: User }) {
  const { changePassword, logout } = useStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user.mustChangePassword) return null;

  const save = async () => {
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    const result = await changePassword(password);
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Couldn't change the password.");
  };

  return (
    <Modal
      open
      onClose={() => {}}
      title="Choose your password"
      subtitle="You signed in with a temporary password. Set your own to continue."
      size="sm"
      footer={
        <>
          <Button onClick={() => void logout()}>Sign out</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? (
              <>
                <ButtonLoader /> Saving…
              </>
            ) : (
              "Set password"
            )}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="New password" required hint={`At least ${MIN_PASSWORD} characters.`}>
          <PasswordInput
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Confirm password" required error={error ?? undefined}>
          <PasswordInput
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
