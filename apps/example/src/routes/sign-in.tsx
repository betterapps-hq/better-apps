import {
  Avatar,
  AvatarFallback,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  Input
} from "@buildkitgg/shadcn-baseui-kit"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { initials } from "../app-shell"
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
  head: () => ({ meta: [{ title: "Sign in – Better Invoices" }] }),
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
  const { redirect = "/invoices" } = Route.useSearch()
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
    <div className="sign-in-page">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>The example signs people in with Better Auth’s email and password sign-in.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "sign-in-error" : undefined}
                />
              </Field>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
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
                  <FieldError id="sign-in-error" role="alert">
                    {error}
                  </FieldError>
                )}
              </Field>
              <Button type="submit" aria-disabled={busy}>
                Sign in
              </Button>
              <FieldSeparator>Or use a demo person</FieldSeparator>
              <section aria-labelledby="demo-title" className="stack">
                <h2 id="demo-title" className="visually-hidden">
                  Demo people
                </h2>
                <ul className="demo-people">
                  {demoUsers.map((person) => (
                    <li key={person.email} className="demo-person">
                      <Avatar>
                        <AvatarFallback>{initials(person.name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <strong>{person.name}</strong>
                        <span>
                          {person.role}, {person.email}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-disabled={busy}
                        onClick={() => void submit(person.email, demoPassword)}
                      >
                        Sign in as {person.name.split(" ")[0]}
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="muted" style={{ fontSize: "0.8125rem" }}>
                  The example signs these people up on its first start. Their password is <code>{demoPassword}</code>.
                  Ada owns the workspace, so she can delete anyone’s comments and threads.
                </p>
              </section>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
