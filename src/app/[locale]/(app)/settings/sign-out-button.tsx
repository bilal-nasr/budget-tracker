"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Submit button for the sign-out form: spinner until the server action has signed out and redirected. */
export function SignOutButton({ disabled, children }: { disabled?: boolean; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" className="w-full" disabled={disabled} loading={pending}>
      {children}
    </Button>
  );
}
