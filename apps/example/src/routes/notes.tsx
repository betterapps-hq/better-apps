import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldLabel,
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Textarea
} from "@buildkitgg/shadcn-baseui-kit"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { SignInPrompt } from "../app-shell"
import { formatTime } from "../format"
import { listNotes } from "../notes.functions"
import { useViewer } from "../viewer"

export const Route = createFileRoute("/notes")({
  loader: () => listNotes(),
  head: () => ({ meta: [{ title: "Notes – Better Invoices" }] }),
  component: Notes
})

interface ErrorBody {
  error?: { message?: string; issues?: { message?: string }[] }
}

/** Adds a note through the feature's HTTP route, and returns the reason when it fails. */
async function addNote(text: string): Promise<string | null> {
  const response = await fetch("/api/apps/notes/add", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  }).catch(() => null)
  if (!response) {
    return "The note couldn't be added. Check your connection and try again."
  }
  if (response.ok) {
    return null
  }
  const body = (await response.json().catch(() => ({}))) as ErrorBody
  return body.error?.issues?.[0]?.message ?? body.error?.message ?? "The note couldn't be added."
}

function Notes() {
  const notes = Route.useLoaderData()
  const viewer = useViewer()
  const router = useRouter()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) {
      return
    }
    setSaving(true)
    setError(null)
    const failure = await addNote(text)
    if (failure) {
      setError(failure)
    } else {
      setText("")
      await router.invalidate()
    }
    setSaving(false)
  }

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <h1>Notes</h1>
          <p>
            A tiny Better Apps feature. The list loads through a server function, and the form posts to the feature’s
            HTTP route.
          </p>
        </div>
      </div>
      <div className="stack">
        <Card>
          <CardContent>
            {viewer ? (
              <form className="stack" onSubmit={handleSubmit}>
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor="note-text">New note</FieldLabel>
                  <Textarea
                    id="note-text"
                    name="text"
                    rows={3}
                    maxLength={500}
                    required
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "note-error" : undefined}
                  />
                  {error && <FieldError id="note-error">{error}</FieldError>}
                </Field>
                <div>
                  {/* aria-disabled rather than disabled, so the button keeps focus while the note saves. */}
                  <Button type="submit" aria-disabled={saving}>
                    {saving ? "Adding note" : "Add note"}
                  </Button>
                </div>
              </form>
            ) : (
              <SignInPrompt>to read and add notes.</SignInPrompt>
            )}
          </CardContent>
        </Card>
        {notes && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Recent notes</h2>
              </CardTitle>
              <CardDescription>The 20 newest, from everyone.</CardDescription>
            </CardHeader>
            <CardContent>
              {notes.length === 0 ? (
                <p className="muted">No notes yet. Add the first one above.</p>
              ) : (
                <ul className="notes">
                  {notes.map((note) => (
                    <li key={note.id}>
                      <Item variant="outline">
                        <ItemContent>
                          <ItemTitle>{note.authorName ?? "Unknown author"}</ItemTitle>
                          <p className="comment-body">{note.text}</p>
                          <ItemDescription>
                            <time dateTime={note.createdAt.toISOString()}>{formatTime(note.createdAt)}</time>
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
