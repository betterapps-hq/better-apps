import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { demoPassword, demoUsers } from "../demo-users"

/**
 * A path on this site to return to after signing in, or `undefined` for anything that would leave it, such as
 * `//evil.example` or `/\evil.example`, which browsers read as other sites.
 */
function sitePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return undefined
  }
  const base = "http://site.invalid"
  try {
    const url = new URL(value, base)
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : undefined
  } catch {
    return undefined
  }
}

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string | undefined } => ({
    redirect: sitePath(search.redirect)
  }),
  head: () => ({ meta: [{ title: "Sign in – Better Apps example" }] }),
  component: SignIn
})

interface ErrorBody {
  message?: string
}

/** Signs in through Better Auth's route, and returns the reason when it fails. */
async function signIn(email: string, password: string): Promise<string | null> {
  const response = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  }).catch(() => null)
  if (!response) {
    return "You couldn’t be signed in. Check your connection and try again."
  }
  if (response.ok) {
    return null
  }
  const body = (await response.json().catch(() => ({}))) as ErrorBody
  return body.message ?? "You couldn’t be signed in."
}

function SignIn() {
  const { redirect = "/" } = Route.useSearch()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(asEmail: string, asPassword: string) {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    const failure = await signIn(asEmail, asPassword)
    if (failure) {
      setError(failure)
      setBusy(false)
      return
    }
    // A full load, so nothing loaded for the signed-out page stays in the browser's stores.
    window.location.assign(redirect)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit(email, password)
  }

  return (
    <>
      <h1>Sign in</h1>
      <p className="lead">The example signs people in with Better Auth’s email and password sign-in.</p>
      <form className="sign-in-form" onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "sign-in-error" : undefined}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "sign-in-error" : undefined}
        />
        {error && (
          <p id="sign-in-error" className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" aria-disabled={busy}>
          Sign in
        </button>
      </form>
      <section aria-labelledby="demo-title">
        <h2 id="demo-title">Demo people</h2>
        <p>
          The example signs these people up on its first start. Their password is <code>{demoPassword}</code>.
        </p>
        <ul className="demo-people">
          {demoUsers.map((person) => (
            <li key={person.email}>
              <span>
                {person.name} <span className="muted">{person.email}</span>
              </span>
              <button
                type="button"
                className="secondary"
                aria-disabled={busy}
                onClick={() => void submit(person.email, demoPassword)}
              >
                Sign in as {person.name.split(" ")[0]}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
