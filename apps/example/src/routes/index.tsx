import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { formatTime } from "../format"
import { listNotes } from "../notes.functions"

export const Route = createFileRoute("/")({
  loader: () => listNotes(),
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
    <>
      <h1>Notes</h1>
      <p className="lead">
        Notes are a small Better Apps feature. The list loads through a server function, and the form posts to the
        feature’s HTTP route.
      </p>
      <form className="note-form" onSubmit={handleSubmit}>
        <label htmlFor="note-text">New note</label>
        <textarea
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
        {error && (
          <p id="note-error" className="form-error" role="alert">
            {error}
          </p>
        )}
        {/* aria-disabled rather than disabled, so the button keeps focus while the note saves. */}
        <button type="submit" aria-disabled={saving}>
          {saving ? "Adding note" : "Add note"}
        </button>
      </form>
      <section aria-labelledby="notes-title">
        <h2 id="notes-title">Recent notes</h2>
        {notes.length === 0 ? (
          <p>No notes yet. Add the first one above.</p>
        ) : (
          <ul className="notes">
            {notes.map((note) => (
              <li key={note.id}>
                <p className="note-text">{note.text}</p>
                <p className="meta">
                  <span>{note.authorName ?? "Unknown author"}</span>
                  <time dateTime={note.createdAt.toISOString()}>{formatTime(note.createdAt)}</time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
