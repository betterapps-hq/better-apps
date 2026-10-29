import { Link, useLocation } from "@tanstack/react-router"
import { useState } from "react"
import { useViewer } from "./viewer"

/** The signed-in person with a way to sign out, or a link to sign in. */
export function Account() {
  const viewer = useViewer()
  const { href } = useLocation()
  const [error, setError] = useState(false)

  async function signOut() {
    setError(false)
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }).catch(() => null)
    if (!response?.ok) {
      setError(true)
      return
    }
    // A full load, so nothing loaded for the signed-in person stays in the browser's stores.
    window.location.assign(href)
  }

  if (!viewer) {
    return (
      <Link to="/sign-in" search={{ redirect: href }}>
        Sign in
      </Link>
    )
  }
  return (
    <div className="account">
      <span>{viewer.name ?? "Signed in"}</span>
      <button type="button" className="text-button" onClick={() => void signOut()}>
        Sign out
      </button>
      {error && (
        <span className="form-error" role="alert">
          Sign-out failed. Try again.
        </span>
      )}
    </div>
  )
}

/** Asks a signed-out visitor to sign in for something only signed-in people see. */
export function SignInPrompt({ children }: { children: string }) {
  const { href } = useLocation()
  return (
    <p>
      <Link to="/sign-in" search={{ redirect: href }}>
        Sign in
      </Link>{" "}
      {children}
    </p>
  )
}
