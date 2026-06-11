"use client";

import { SignUp } from "@clerk/clerk-react";

export default function SignUpPage() {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SignUp />
    </div>
  );
}
